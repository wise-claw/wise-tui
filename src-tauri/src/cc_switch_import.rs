//! 从 CC Switch（桌面 `~/.cc-switch/cc-switch.db` 或 CLI `~/.ccswitch/ccs.json`）导入 Claude / Codex 模型档案。

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Deserialize;
use uuid::Uuid;

use crate::claude_model_profiles::{
    load_store, read_effective_model, save_store, store_view, ClaudeModelProfile,
    ClaudeModelProfileStoreView,
};
use crate::codex_config_dir::{
    parse_codex_profile_envelope, read_effective_codex_model_from_envelope,
};
use crate::wise_db::WiseDb;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchSyncResult {
    pub store: ClaudeModelProfileStoreView,
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    /// 数据来源说明，例如 `cc-switch.db` / `ccs.json`。
    pub source: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct LegacyCcsFile {
    #[serde(default)]
    profiles: std::collections::HashMap<String, serde_json::Value>,
}

struct ImportedProfile {
    engine: String,
    company: String,
    name: String,
    settings_json: String,
    model_id: String,
}

/// 从 CC Switch `providers.name` 推断公司名（与 CC Switch 常见 `公司-模型` 命名一致）。
fn infer_company_from_cc_switch_name(provider_name: &str) -> String {
    let s = provider_name.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Some((head, tail)) = s.split_once('-') {
        let head = head.trim();
        let tail = tail.trim();
        if !head.is_empty() && !tail.is_empty() {
            return head.to_string();
        }
    }
    s.to_string()
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn cc_switch_db_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CC_SWITCH_DB_PATH") {
        let t = p.trim();
        if !t.is_empty() {
            return Some(PathBuf::from(t));
        }
    }
    home_dir().map(|h| h.join(".cc-switch").join("cc-switch.db"))
}

fn legacy_ccs_json_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CCSWITCH_PROFILES_PATH") {
        let t = p.trim();
        if !t.is_empty() {
            return Some(PathBuf::from(t));
        }
    }
    home_dir().map(|h| h.join(".ccswitch").join("ccs.json"))
}

fn normalize_settings_root(v: serde_json::Value) -> Result<serde_json::Value, String> {
    if v.is_null() {
        return Ok(serde_json::json!({}));
    }
    if !v.is_object() {
        return Err("配置顶层必须是 JSON 对象".to_string());
    }
    let obj = v.as_object().unwrap();
    if obj.contains_key("env") || !obj.values().any(|x| x.is_string()) {
        return Ok(v);
    }
    // 旧版 ccs.json：profile 为扁平 env 键值
    Ok(serde_json::json!({ "env": v }))
}

fn profile_from_settings(
    name: &str,
    settings: serde_json::Value,
    engine: &str,
) -> Result<ImportedProfile, String> {
    let label = name.trim();
    if label.is_empty() {
        return Err("配置名称为空".to_string());
    }
    let engine_key = if engine.trim().eq_ignore_ascii_case("codex") {
        "codex"
    } else {
        "claude"
    };

    if engine_key == "codex" {
        let envelope = parse_codex_profile_envelope(
            &serde_json::to_string(&settings).map_err(|e| e.to_string())?,
        )?;
        let pretty = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
        let model_id = read_effective_codex_model_from_envelope(&envelope)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "custom".to_string());
        return Ok(ImportedProfile {
            engine: engine_key.to_string(),
            company: infer_company_from_cc_switch_name(label),
            name: label.to_string(),
            settings_json: pretty,
            model_id,
        });
    }

    let root = normalize_settings_root(settings)?;
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    let model_id = read_effective_model(&root)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "custom".to_string());
    Ok(ImportedProfile {
        engine: engine_key.to_string(),
        company: infer_company_from_cc_switch_name(label),
        name: label.to_string(),
        settings_json: pretty,
        model_id,
    })
}

fn load_from_cc_switch_db(path: &Path) -> Result<Vec<ImportedProfile>, String> {
    let conn = Connection::open(path).map_err(|e| format!("无法打开 CC Switch 数据库：{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT name, settings_config, app_type FROM providers \
             WHERE app_type IN ('claude', 'codex') \
             ORDER BY COALESCE(sort_index, 999999), created_at ASC, name ASC",
        )
        .map_err(|e| format!("读取 providers 表失败：{e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let settings_config_str: String = row.get(1)?;
            let app_type: String = row.get(2)?;
            Ok((name, settings_config_str, app_type))
        })
        .map_err(|e| format!("查询 CC Switch 供应商失败：{e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (name, raw, app_type) = row.map_err(|e| e.to_string())?;
        let settings: serde_json::Value =
            serde_json::from_str(raw.trim()).unwrap_or(serde_json::json!({}));
        match profile_from_settings(&name, settings, &app_type) {
            Ok(p) => out.push(p),
            Err(_) => continue,
        }
    }
    Ok(out)
}

fn load_from_legacy_ccs_json(path: &Path) -> Result<Vec<ImportedProfile>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("无法读取 ccs.json：{e}"))?;
    let parsed: LegacyCcsFile =
        serde_json::from_str(&text).map_err(|e| format!("ccs.json 解析失败：{e}"))?;
    let mut out = Vec::new();
    for (name, env_val) in parsed.profiles {
        match profile_from_settings(&name, env_val, "claude") {
            Ok(p) => out.push(p),
            Err(_) => continue,
        }
    }
    Ok(out)
}

fn load_cc_switch_profiles() -> Result<(Vec<ImportedProfile>, String), String> {
    if let Some(db) = cc_switch_db_path() {
        if db.is_file() {
            let list = load_from_cc_switch_db(&db)?;
            if !list.is_empty() {
                return Ok((list, "cc-switch.db".to_string()));
            }
        }
    }
    if let Some(json) = legacy_ccs_json_path() {
        if json.is_file() {
            let list = load_from_legacy_ccs_json(&json)?;
            if !list.is_empty() {
                return Ok((list, "ccs.json".to_string()));
            }
        }
    }
    Err(
        "未找到 CC Switch 配置。请确认已安装 CC Switch，且存在 ~/.cc-switch/cc-switch.db 或 ~/.ccswitch/ccs.json。"
            .to_string(),
    )
}

fn merge_imported_into_store(
    store: &mut super::claude_model_profiles::ClaudeModelProfileStore,
    imported: Vec<ImportedProfile>,
) -> (usize, usize, usize) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;

    for item in imported {
        let name_key = item.name.to_lowercase();
        let engine_key = item.engine.to_lowercase();
        if let Some(slot) = store.profiles.iter_mut().find(|p| {
            p.name.trim().to_lowercase() == name_key
                && p.engine.trim().eq_ignore_ascii_case(&engine_key)
        }) {
            if slot.settings_json.trim() == item.settings_json.trim()
                && slot.model_id.trim() == item.model_id.trim()
                && slot.company.trim() == item.company.trim()
            {
                skipped += 1;
                continue;
            }
            slot.company = item.company;
            slot.settings_json = item.settings_json;
            slot.model_id = item.model_id;
            slot.engine = item.engine;
            slot.updated_at_ms = now;
            updated += 1;
        } else {
            store.profiles.push(ClaudeModelProfile {
                id: Uuid::new_v4().to_string(),
                company: item.company,
                name: item.name,
                model_id: item.model_id,
                settings_json: item.settings_json,
                engine: item.engine,
                created_at_ms: now,
                updated_at_ms: now,
            });
            added += 1;
        }
    }
    (added, updated, skipped)
}

#[tauri::command]
pub(crate) fn sync_claude_model_profiles_from_cc_switch(
    db: tauri::State<'_, WiseDb>,
) -> Result<CcSwitchSyncResult, String> {
    let (imported, source) = load_cc_switch_profiles()?;
    let mut store = load_store(&db);
    let (added, updated, skipped) = merge_imported_into_store(&mut store, imported);
    save_store(&db, &store)?;

    let message = if added == 0 && updated == 0 {
        format!("已从 {source} 读取配置，无新增或更新（{skipped} 条已是最新）")
    } else {
        format!(
            "已从 {source} 同步：新增 {added} 条，更新 {updated} 条{}",
            if skipped > 0 {
                format!("，跳过 {skipped} 条")
            } else {
                String::new()
            }
        )
    };

    Ok(CcSwitchSyncResult {
        store: store_view(&db),
        added,
        updated,
        skipped,
        source,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_provider_envelope() {
        let v = serde_json::json!({
            "auth": { "OPENAI_API_KEY": "sk-test", "auth_mode": "apikey" },
            "config": "model = \"gpt-5.4\"\n"
        });
        let p = profile_from_settings("default", v, "codex").expect("profile");
        assert_eq!(p.engine, "codex");
        assert_eq!(p.model_id, "gpt-5.4");
    }

    #[test]
    fn flattens_legacy_env_map() {
        let v = serde_json::json!({
            "ANTHROPIC_MODEL": "qwen3.6",
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:8082"
        });
        let p = profile_from_settings("test", v, "claude").expect("profile");
        assert_eq!(p.model_id, "qwen3.6");
        assert!(p.settings_json.contains("\"env\""));
    }

    #[test]
    fn infers_company_from_hyphenated_provider_name() {
        assert_eq!(
            infer_company_from_cc_switch_name("Bailian-qwen3.6"),
            "Bailian"
        );
        assert_eq!(
            infer_company_from_cc_switch_name("Claude Official"),
            "Claude Official"
        );
    }
}
