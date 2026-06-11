//! `assistant_overrides` 表 CRUD。
//!
//! 与 `assistant_custom`(用户自建助手定义本身)不同,这里存的是
//! 任意助手(builtin / custom / extension)在三种作用域下的"覆盖":
//! prompt 分层、skill 挂载、MCP 挂载、engineering 偏好。
//!
//! scope 取值:
//!   - "assistant"           — 助手全局覆盖
//!   - "project:<id>"        — 该助手在某项目内的覆盖
//!   - "repository:<id>"     — 该助手在某仓库内的覆盖

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::wise_db::unix_now_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantOverridesRow {
    pub assistant_id: String,
    pub scope: String,
    /// 原 JSON 字符串。前端按 `parsePromptStorageRaw` 解析。
    pub prompt_layers_json: String,
    pub skill_bundle_json: String,
    pub mcp_bundle_json: String,
    pub engineering_json: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantOverridesPatch {
    /// 任一字段为 None 表示"该 section 不变";为 Some 表示"覆盖整段 JSON 字符串"。
    /// 想要清空某 section 请传 Some("{}".to_string())。
    pub prompt_layers_json: Option<String>,
    pub skill_bundle_json: Option<String>,
    pub mcp_bundle_json: Option<String>,
    pub engineering_json: Option<String>,
}

/// 重置 section 选择。
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetSection {
    Prompts,
    Skills,
    Mcps,
    Engineering,
    All,
}

pub fn validate_scope(scope: &str) -> Result<(), String> {
    if scope == "assistant" {
        return Ok(());
    }
    if let Some(rest) = scope.strip_prefix("project:") {
        if rest.trim().is_empty() {
            return Err("project scope must include id".into());
        }
        return Ok(());
    }
    if let Some(rest) = scope.strip_prefix("repository:") {
        if rest.trim().is_empty() {
            return Err("repository scope must include id".into());
        }
        return Ok(());
    }
    Err(format!(
        "invalid scope `{scope}`: expected `assistant`, `project:<id>`, or `repository:<id>`"
    ))
}

fn validate_json(json: &str, field: &str) -> Result<(), String> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty (use \"{{}}\" for none)"));
    }
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("{field} is not valid JSON: {e}"))?;
    Ok(())
}

pub fn get(
    conn: &Connection,
    assistant_id: &str,
    scope: &str,
) -> Result<Option<AssistantOverridesRow>, String> {
    validate_scope(scope)?;
    conn.query_row(
        "SELECT assistant_id, scope, prompt_layers_json, skill_bundle_json,
                mcp_bundle_json, engineering_json, updated_at
         FROM assistant_overrides
         WHERE assistant_id = ?1 AND scope = ?2",
        params![assistant_id, scope],
        |row| {
            Ok(AssistantOverridesRow {
                assistant_id: row.get(0)?,
                scope: row.get(1)?,
                prompt_layers_json: row.get(2)?,
                skill_bundle_json: row.get(3)?,
                mcp_bundle_json: row.get(4)?,
                engineering_json: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn list_for_assistant(
    conn: &Connection,
    assistant_id: &str,
) -> Result<Vec<AssistantOverridesRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT assistant_id, scope, prompt_layers_json, skill_bundle_json,
                    mcp_bundle_json, engineering_json, updated_at
             FROM assistant_overrides
             WHERE assistant_id = ?1
             ORDER BY scope ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![assistant_id], |row| {
            Ok(AssistantOverridesRow {
                assistant_id: row.get(0)?,
                scope: row.get(1)?,
                prompt_layers_json: row.get(2)?,
                skill_bundle_json: row.get(3)?,
                mcp_bundle_json: row.get(4)?,
                engineering_json: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn save(
    conn: &Connection,
    assistant_id: &str,
    scope: &str,
    patch: &AssistantOverridesPatch,
) -> Result<AssistantOverridesRow, String> {
    if assistant_id.trim().is_empty() {
        return Err("assistantId must not be empty".into());
    }
    validate_scope(scope)?;
    if let Some(s) = &patch.prompt_layers_json {
        validate_json(s, "promptLayersJson")?;
    }
    if let Some(s) = &patch.skill_bundle_json {
        validate_json(s, "skillBundleJson")?;
    }
    if let Some(s) = &patch.mcp_bundle_json {
        validate_json(s, "mcpBundleJson")?;
    }
    if let Some(s) = &patch.engineering_json {
        validate_json(s, "engineeringJson")?;
    }

    let existing = get(conn, assistant_id, scope)?;
    let now = unix_now_ms();
    let row = AssistantOverridesRow {
        assistant_id: assistant_id.to_string(),
        scope: scope.to_string(),
        prompt_layers_json: patch
            .prompt_layers_json
            .clone()
            .or_else(|| existing.as_ref().map(|r| r.prompt_layers_json.clone()))
            .unwrap_or_else(|| "{}".to_string()),
        skill_bundle_json: patch
            .skill_bundle_json
            .clone()
            .or_else(|| existing.as_ref().map(|r| r.skill_bundle_json.clone()))
            .unwrap_or_else(|| "{}".to_string()),
        mcp_bundle_json: patch
            .mcp_bundle_json
            .clone()
            .or_else(|| existing.as_ref().map(|r| r.mcp_bundle_json.clone()))
            .unwrap_or_else(|| "{}".to_string()),
        engineering_json: patch
            .engineering_json
            .clone()
            .or_else(|| existing.as_ref().map(|r| r.engineering_json.clone()))
            .unwrap_or_else(|| "{}".to_string()),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO assistant_overrides (
            assistant_id, scope, prompt_layers_json, skill_bundle_json,
            mcp_bundle_json, engineering_json, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(assistant_id, scope) DO UPDATE SET
            prompt_layers_json = excluded.prompt_layers_json,
            skill_bundle_json  = excluded.skill_bundle_json,
            mcp_bundle_json    = excluded.mcp_bundle_json,
            engineering_json   = excluded.engineering_json,
            updated_at         = excluded.updated_at",
        params![
            row.assistant_id,
            row.scope,
            row.prompt_layers_json,
            row.skill_bundle_json,
            row.mcp_bundle_json,
            row.engineering_json,
            row.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn delete_all_for_assistant(conn: &Connection, assistant_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM assistant_overrides WHERE assistant_id = ?1",
        params![assistant_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reset(
    conn: &Connection,
    assistant_id: &str,
    scope: &str,
    sections: &[ResetSection],
) -> Result<(), String> {
    validate_scope(scope)?;
    if sections.iter().any(|s| *s == ResetSection::All) || sections.is_empty() {
        conn.execute(
            "DELETE FROM assistant_overrides WHERE assistant_id = ?1 AND scope = ?2",
            params![assistant_id, scope],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let now = unix_now_ms();
    for section in sections {
        let column = match section {
            ResetSection::Prompts => "prompt_layers_json",
            ResetSection::Skills => "skill_bundle_json",
            ResetSection::Mcps => "mcp_bundle_json",
            ResetSection::Engineering => "engineering_json",
            ResetSection::All => unreachable!(),
        };
        let sql = format!(
            "UPDATE assistant_overrides SET {column} = '{{}}', updated_at = ?1
             WHERE assistant_id = ?2 AND scope = ?3"
        );
        conn.execute(&sql, params![now, assistant_id, scope])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/028_assistant_overrides.sql"))
            .unwrap();
        conn
    }

    fn patch(prompt: &str) -> AssistantOverridesPatch {
        AssistantOverridesPatch {
            prompt_layers_json: Some(prompt.to_string()),
            skill_bundle_json: None,
            mcp_bundle_json: None,
            engineering_json: None,
        }
    }

    #[test]
    fn save_then_get() {
        let conn = open();
        let row = save(&conn, "builtin:prd-split", "assistant", &patch("{\"a\":1}")).unwrap();
        assert_eq!(row.prompt_layers_json, "{\"a\":1}");
        assert_eq!(row.skill_bundle_json, "{}");
        let fetched = get(&conn, "builtin:prd-split", "assistant").unwrap();
        assert_eq!(fetched.unwrap().prompt_layers_json, "{\"a\":1}");
    }

    #[test]
    fn save_partial_keeps_other_sections() {
        let conn = open();
        save(
            &conn,
            "builtin:prd-split",
            "assistant",
            &AssistantOverridesPatch {
                prompt_layers_json: Some("{\"p\":1}".to_string()),
                skill_bundle_json: Some("{\"s\":1}".to_string()),
                mcp_bundle_json: None,
                engineering_json: None,
            },
        )
        .unwrap();
        let after = save(&conn, "builtin:prd-split", "assistant", &patch("{\"p\":2}")).unwrap();
        assert_eq!(after.prompt_layers_json, "{\"p\":2}");
        assert_eq!(after.skill_bundle_json, "{\"s\":1}");
    }

    #[test]
    fn invalid_json_rejected() {
        let conn = open();
        let bad = AssistantOverridesPatch {
            prompt_layers_json: Some("not-json".to_string()),
            ..Default::default()
        };
        assert!(save(&conn, "builtin:prd-split", "assistant", &bad).is_err());
    }

    #[test]
    fn invalid_scope_rejected() {
        let conn = open();
        assert!(save(&conn, "builtin:prd-split", "weird", &patch("{}")).is_err());
        assert!(save(&conn, "builtin:prd-split", "project:", &patch("{}")).is_err());
        assert!(save(&conn, "builtin:prd-split", "project:wise-1", &patch("{}")).is_ok());
    }

    #[test]
    fn reset_section() {
        let conn = open();
        save(
            &conn,
            "builtin:prd-split",
            "assistant",
            &AssistantOverridesPatch {
                prompt_layers_json: Some("{\"p\":1}".to_string()),
                skill_bundle_json: Some("{\"s\":1}".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        reset(&conn, "builtin:prd-split", "assistant", &[ResetSection::Skills]).unwrap();
        let row = get(&conn, "builtin:prd-split", "assistant").unwrap().unwrap();
        assert_eq!(row.skill_bundle_json, "{}");
        assert_eq!(row.prompt_layers_json, "{\"p\":1}");
    }

    #[test]
    fn reset_all_deletes_row() {
        let conn = open();
        save(&conn, "builtin:prd-split", "assistant", &patch("{\"p\":1}")).unwrap();
        reset(&conn, "builtin:prd-split", "assistant", &[ResetSection::All]).unwrap();
        assert!(get(&conn, "builtin:prd-split", "assistant").unwrap().is_none());
    }
}
