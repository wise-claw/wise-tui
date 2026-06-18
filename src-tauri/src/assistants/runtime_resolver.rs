//! 解析助手在某 (assistant_id, project, repository) 下的"运行态":
//! - 合并后的 prompt layers(三 slot)
//! - 合并后的 skill bundle(disabled / custom 列表;PRD 内置 workflow 不走这里注入)
//! - 合并后的 mcp bundle
//! - engineering 偏好
//! - system prompt 与可调用 tool 列表
//!
//! 合并顺序(后者覆盖前者非空字段):
//!   platform_default(由前端持有)→ builtin assistant_default → assistant scope
//!     → project scope → repository scope
//!
//! 这里只负责把数据库取到的覆盖层叠到 builtin 上,不参与 platform_default;
//! platform_default 仍由前端 `splitPromptTemplate.ts` 拥有,因为它需要参与
//! 渲染时的占位符替换。
//!
//! 返回结构尽量保持 JSON 字符串原样,前端按 `parsePromptStorageRaw` 解析。

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::builtins::{self, BuiltinAssistantBundle, BuiltinPromptLayer};
use super::overrides::{self};
use rusqlite::Connection;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntime {
    pub assistant_id: String,
    pub source: AssistantSourceTag,
    pub system_prompt: String,
    pub tools: Vec<String>,
    pub model: Option<String>,
    pub engine_id: String,
    /// 合并后的 prompt 分层 JSON(同前端 v2 schema:`{ schemaVersion, prompts: { slot: layers }}`)。
    pub prompt_bundle_json: String,
    pub skill_bundle_json: String,
    pub mcp_bundle_json: String,
    pub engineering_json: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantSourceTag {
    Builtin,
    Custom,
    /// 助手 id 不在任何注册表里;返回时退化为通用 PRD 拆分配置(用于旧 mission 的兜底)。
    Legacy,
}

#[derive(Debug, Clone, Default)]
pub struct ResolveScopes<'a> {
    pub project_id: Option<&'a str>,
    pub repository_id: Option<&'a str>,
}

pub fn resolve(
    conn: &Connection,
    assistant_id: &str,
    scopes: ResolveScopes<'_>,
) -> Result<ResolvedRuntime, String> {
    let bundle = builtins::find(assistant_id);
    let mut prompt_bundle = match bundle {
        Some(b) => bundle_default_prompts(b),
        None => empty_prompt_bundle(),
    };
    let mut skill_bundle = match bundle {
        Some(b) => bundle_default_skills(b),
        None => json!({ "disabled": [], "custom": [] }),
    };
    let mut mcp_bundle = match bundle {
        Some(b) => bundle_default_mcps(b),
        None => json!({ "disabled": [], "custom": [] }),
    };
    let mut engineering = json!({});

    let scopes_in_order = ordered_scopes(&scopes);
    for scope in scopes_in_order {
        let Some(row) = overrides::get(conn, assistant_id, &scope)? else {
            continue;
        };
        merge_prompt_bundle(&mut prompt_bundle, &row.prompt_layers_json);
        merge_object(&mut skill_bundle, &row.skill_bundle_json);
        merge_object(&mut mcp_bundle, &row.mcp_bundle_json);
        merge_object(&mut engineering, &row.engineering_json);
    }

    let (system_prompt, tools, engine_id, model, source) = match bundle {
        Some(b) => (
            b.system_prompt.to_string(),
            b.tools.iter().map(|s| s.to_string()).collect(),
            b.engine_id.to_string(),
            b.model.map(|s| s.to_string()),
            AssistantSourceTag::Builtin,
        ),
        None => fallback_metadata(conn, assistant_id)?,
    };

    Ok(ResolvedRuntime {
        assistant_id: assistant_id.to_string(),
        source,
        system_prompt,
        tools,
        model,
        engine_id,
        prompt_bundle_json: serde_json::to_string(&prompt_bundle)
            .map_err(|e| e.to_string())?,
        skill_bundle_json: serde_json::to_string(&skill_bundle).map_err(|e| e.to_string())?,
        mcp_bundle_json: serde_json::to_string(&mcp_bundle).map_err(|e| e.to_string())?,
        engineering_json: serde_json::to_string(&engineering).map_err(|e| e.to_string())?,
    })
}

fn ordered_scopes(scopes: &ResolveScopes<'_>) -> Vec<String> {
    let mut out = vec!["assistant".to_string()];
    if let Some(p) = scopes.project_id.filter(|s| !s.is_empty()) {
        out.push(format!("project:{p}"));
    }
    if let Some(r) = scopes.repository_id.filter(|s| !s.is_empty()) {
        out.push(format!("repository:{r}"));
    }
    out
}

fn bundle_default_prompts(b: &BuiltinAssistantBundle) -> Value {
    let mut prompts = Map::new();
    prompts.insert(
        b.default_prompt_layers.prd_task_split.template_id.to_string(),
        layer_to_value(&b.default_prompt_layers.prd_task_split),
    );
    prompts.insert(
        b.default_prompt_layers.phase1.template_id.to_string(),
        layer_to_value(&b.default_prompt_layers.phase1),
    );
    prompts.insert(
        b.default_prompt_layers.phase2.template_id.to_string(),
        layer_to_value(&b.default_prompt_layers.phase2),
    );
    json!({ "schemaVersion": 2, "prompts": Value::Object(prompts) })
}

fn empty_prompt_bundle() -> Value {
    json!({ "schemaVersion": 2, "prompts": {} })
}

fn layer_to_value(layer: &BuiltinPromptLayer) -> Value {
    json!({
        "templateId": layer.template_id,
        "version": layer.version,
        "enabled": layer.enabled,
        "systemBody": layer.system_body,
        "repoStrategyBody": layer.repo_strategy_body,
        "userBody": layer.user_body,
    })
}

fn bundle_default_skills(b: &BuiltinAssistantBundle) -> Value {
    let custom: Vec<Value> = b
        .default_skills
        .iter()
        .map(|s| {
            json!({
                "id": s.id,
                "sourcePath": s.source_path,
                "label": s.label,
                "origin": "builtin",
            })
        })
        .collect();
    json!({ "disabled": [], "custom": custom })
}

fn bundle_default_mcps(b: &BuiltinAssistantBundle) -> Value {
    let custom: Vec<Value> = b
        .default_mcps
        .iter()
        .map(|m| json!({ "id": m.id, "label": m.label, "origin": "builtin" }))
        .collect();
    json!({ "disabled": [], "custom": custom })
}

/// 把 patch_json 解析后,以"字段非空覆盖"的方式合并进 base prompt bundle。
/// 仅识别 v2 形态 `{ schemaVersion, prompts: { slot: SplitPromptTemplateLayers } }`。
fn merge_prompt_bundle(base: &mut Value, patch_json: &str) {
    let trimmed = patch_json.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return;
    }
    let Ok(patch) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };
    let Some(patch_prompts) = patch.get("prompts").and_then(|v| v.as_object()) else {
        return;
    };
    let Some(base_obj) = base.as_object_mut() else {
        return;
    };
    let base_prompts = base_obj
        .entry("prompts".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(base_prompts) = base_prompts.as_object_mut() else {
        return;
    };
    for (slot_id, patch_layer) in patch_prompts {
        let Some(patch_layer) = patch_layer.as_object() else {
            continue;
        };
        let entry = base_prompts
            .entry(slot_id.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        let Some(entry_obj) = entry.as_object_mut() else {
            continue;
        };
        for (k, v) in patch_layer {
            if value_is_empty_overlay(v) {
                continue;
            }
            entry_obj.insert(k.clone(), v.clone());
        }
    }
}

/// 顶层对象合并:patch 的非空字段覆盖 base。
fn merge_object(base: &mut Value, patch_json: &str) {
    let trimmed = patch_json.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return;
    }
    let Ok(patch) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };
    let Some(patch_obj) = patch.as_object() else {
        return;
    };
    let Some(base_obj) = base.as_object_mut() else {
        return;
    };
    for (k, v) in patch_obj {
        if value_is_empty_overlay(v) {
            continue;
        }
        base_obj.insert(k.clone(), v.clone());
    }
}

fn value_is_empty_overlay(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        _ => false,
    }
}

fn fallback_metadata(
    conn: &Connection,
    assistant_id: &str,
) -> Result<(String, Vec<String>, String, Option<String>, AssistantSourceTag), String> {
    if let Some(custom_id) = assistant_id.strip_prefix("custom:") {
        if let Some(row) = crate::assistants::storage::get_by_id(conn, custom_id)? {
            return Ok((
                row.system_prompt,
                Vec::new(),
                row.engine_id,
                row.model,
                AssistantSourceTag::Custom,
            ));
        }
    }
    Ok((
        String::new(),
        Vec::new(),
        "claude".to_string(),
        None,
        AssistantSourceTag::Legacy,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/028_assistant_overrides.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/026_assistant_custom.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn resolve_unknown_assistant_falls_back_to_legacy() {
        let conn = open();
        let r = resolve(&conn, "builtin:prd-split", ResolveScopes::default()).unwrap();
        assert_eq!(r.source, AssistantSourceTag::Legacy);
        assert_eq!(r.engine_id, "claude");
    }

    #[test]
    fn resolve_legacy_id_falls_back_to_minimal() {
        let conn = open();
        let r = resolve(&conn, "builtin:not-a-thing", ResolveScopes::default()).unwrap();
        assert_eq!(r.source, AssistantSourceTag::Legacy);
        assert_eq!(r.system_prompt, "");
    }

    #[test]
    fn assistant_scope_overrides_skill_bundle() {
        let conn = open();
        overrides::save(
            &conn,
            "test-assistant",
            "assistant",
            &overrides::AssistantOverridesPatch {
                skill_bundle_json: Some(
                    "{\"disabled\":[\"builtin:trellis-brainstorm\"]}".to_string(),
                ),
                ..Default::default()
            },
        )
        .unwrap();
        let r = resolve(&conn, "test-assistant", ResolveScopes::default()).unwrap();
        let skill: Value = serde_json::from_str(&r.skill_bundle_json).unwrap();
        assert_eq!(skill["disabled"][0].as_str().unwrap(), "builtin:trellis-brainstorm");
        assert!(skill["custom"].as_array().unwrap().is_empty());
    }

    #[test]
    fn project_scope_overrides_assistant_scope() {
        let conn = open();
        overrides::save(
            &conn,
            "test-assistant",
            "assistant",
            &overrides::AssistantOverridesPatch {
                engineering_json: Some("{\"reuseExistingParents\":true}".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        overrides::save(
            &conn,
            "test-assistant",
            "project:p1",
            &overrides::AssistantOverridesPatch {
                engineering_json: Some("{\"reuseExistingParents\":false}".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        let r = resolve(
            &conn,
            "test-assistant",
            ResolveScopes {
                project_id: Some("p1"),
                repository_id: None,
            },
        )
        .unwrap();
        let eng: Value = serde_json::from_str(&r.engineering_json).unwrap();
        assert_eq!(eng["reuseExistingParents"].as_bool().unwrap(), false);
    }

    #[test]
    fn empty_string_does_not_override() {
        let conn = open();
        overrides::save(
            &conn,
            "test-assistant",
            "assistant",
            &overrides::AssistantOverridesPatch {
                prompt_layers_json: Some(
                    "{\"prompts\":{\"prdTaskSplit\":{\"systemBody\":\"\"}}}".to_string(),
                ),
                ..Default::default()
            },
        )
        .unwrap();
        let r = resolve(&conn, "test-assistant", ResolveScopes::default()).unwrap();
        let bundle: Value = serde_json::from_str(&r.prompt_bundle_json).unwrap();
        assert!(bundle["prompts"]["prdTaskSplit"].is_object());
    }
}
