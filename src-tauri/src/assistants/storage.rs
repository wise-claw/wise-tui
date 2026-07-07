//! SQLite CRUD for `assistant_custom`.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAssistantRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub avatar_color: Option<String>,
    pub engine_id: String,
    pub system_prompt: String,
    pub model: Option<String>,
    pub entry_kind: String,
    pub entry_url: String,
    pub entry_workflow_id: Option<String>,
    pub entry_script: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAssistantInput {
    /// When provided, edits an existing row. Otherwise insert a new one.
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub avatar_color: Option<String>,
    pub engine_id: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "default_entry_kind")]
    pub entry_kind: String,
    #[serde(default)]
    pub entry_url: String,
    #[serde(default)]
    pub entry_workflow_id: Option<String>,
    #[serde(default)]
    pub entry_script: String,
}

fn default_entry_kind() -> String {
    "dispatch_direct".to_string()
}

pub fn list(conn: &Connection) -> Result<Vec<CustomAssistantRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, avatar_color, engine_id, system_prompt, model,
                    entry_kind, entry_url, entry_workflow_id, entry_script, created_at, updated_at
             FROM assistant_custom ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_assistant)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<CustomAssistantRow>, String> {
    conn.query_row(
        "SELECT id, name, description, avatar_color, engine_id, system_prompt, model,
                entry_kind, entry_url, entry_workflow_id, entry_script, created_at, updated_at
         FROM assistant_custom WHERE id = ?1",
        params![id],
        row_to_assistant,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn normalize_entry_kind(raw: &str) -> Result<&'static str, String> {
    match raw.trim() {
        // 「对话助手」形态已下线：legacy 值或缺省一律折叠为「立即执行」。
        "conversation" | "dispatch_direct" | "" => Ok("dispatch_direct"),
        "open_link" => Ok("open_link"),
        "run_workflow" => Ok("run_workflow"),
        "run_script" => Ok("run_script"),
        other => Err(format!("unsupported entryKind: {other}")),
    }
}

pub fn upsert(conn: &Connection, input: &CustomAssistantInput) -> Result<CustomAssistantRow, String> {
    if input.name.trim().is_empty() {
        return Err("name must not be empty".to_string());
    }
    let entry_kind = normalize_entry_kind(&input.entry_kind)?;
    if input.engine_id.trim().is_empty() && entry_kind == "dispatch_direct" {
        return Err("engineId must not be empty".to_string());
    }
    if entry_kind == "open_link" {
        let url = input.entry_url.trim();
        if url.is_empty() {
            return Err("entryUrl must not be empty for open_link".to_string());
        }
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("entryUrl must start with http:// or https://".to_string());
        }
    }
    if entry_kind == "run_workflow" {
        // run_workflow 的 entryWorkflowId 改为可选：留空时走「轻量 executeSession」
        // （与 dispatch_direct 等价），有值时按所选工作流入队（leader worker 拉起）。
        // 这里不再做非空校验，激活阶段由前端 + executeSession 共同决定。
    }
    if entry_kind == "run_script" && input.entry_script.trim().is_empty() {
        return Err("entryScript must not be empty for run_script".to_string());
    }
    let engine_id = if input.engine_id.trim().is_empty() {
        "claude".to_string()
    } else {
        input.engine_id.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    let (id, created_at) = match input.id.as_deref() {
        Some(existing_id) => match get_by_id(conn, existing_id)? {
            Some(prev) => (prev.id, prev.created_at),
            None => (existing_id.to_string(), now.clone()),
        },
        None => (Uuid::new_v4().to_string(), now.clone()),
    };
    conn.execute(
        "INSERT INTO assistant_custom (id, name, description, avatar_color, engine_id, system_prompt, model,
                                       entry_kind, entry_url, entry_workflow_id, entry_script, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           avatar_color = excluded.avatar_color,
           engine_id = excluded.engine_id,
           system_prompt = excluded.system_prompt,
           model = excluded.model,
           entry_kind = excluded.entry_kind,
           entry_url = excluded.entry_url,
           entry_workflow_id = excluded.entry_workflow_id,
           entry_script = excluded.entry_script,
           updated_at = excluded.updated_at",
        params![
            id,
            input.name,
            input.description,
            input.avatar_color,
            engine_id,
            input.system_prompt,
            input.model,
            entry_kind,
            input.entry_url,
            input.entry_workflow_id,
            input.entry_script,
            created_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_by_id(conn, &id)?.ok_or_else(|| "row missing after upsert".to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM assistant_custom WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("no assistant with id {id}"));
    }
    Ok(())
}

fn row_to_assistant(row: &rusqlite::Row<'_>) -> rusqlite::Result<CustomAssistantRow> {
    Ok(CustomAssistantRow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        avatar_color: row.get(3)?,
        engine_id: row.get(4)?,
        system_prompt: row.get(5)?,
        model: row.get(6)?,
        entry_kind: row.get(7)?,
        entry_url: row.get(8)?,
        entry_workflow_id: row.get(9)?,
        entry_script: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/026_assistant_custom.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/037_assistant_custom_entry.sql"))
            .unwrap();
        conn
    }

    fn input(name: &str, engine: &str) -> CustomAssistantInput {
        CustomAssistantInput {
            id: None,
            name: name.to_string(),
            description: format!("{name} desc"),
            avatar_color: Some("#165DFF".to_string()),
            engine_id: engine.to_string(),
            system_prompt: "You are helpful.".to_string(),
            model: None,
            // 「对话助手」形态已下线：默认入口类型跟随 builtin/extension
            // fallback 一致，采用「立即执行」(dispatch_direct)。
            entry_kind: "dispatch_direct".to_string(),
            entry_url: String::new(),
            entry_workflow_id: None,
            entry_script: String::new(),
        }
    }

    #[test]
    fn upsert_dispatch_direct_requires_engine() {
        let conn = open_in_memory();
        let mut bad = input("dispatch", "");
        bad.engine_id = "".to_string();
        assert!(upsert(&conn, &bad).is_err());
        let good = input("dispatch", "claude");
        let row = upsert(&conn, &good).unwrap();
        assert_eq!(row.entry_kind, "dispatch_direct");
    }

    #[test]
    fn legacy_conversation_kind_is_normalized_to_dispatch_direct() {
        let conn = open_in_memory();
        let mut legacy = input("legacy", "claude");
        // 旧持久化数据中残留的 conversation 在写入路径上会被归一化为
        // dispatch_direct，向前兼容而无需数据迁移。
        legacy.entry_kind = "conversation".to_string();
        let row = upsert(&conn, &legacy).unwrap();
        assert_eq!(row.entry_kind, "dispatch_direct");
    }

    #[test]
    fn round_trip_insert_list_delete() {
        let conn = open_in_memory();
        let row = upsert(&conn, &input("foo", "claude")).unwrap();
        assert_eq!(row.name, "foo");
        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        delete(&conn, &row.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn upsert_with_id_keeps_created_at() {
        let conn = open_in_memory();
        let first = upsert(&conn, &input("bar", "claude")).unwrap();
        let mut edit = input("bar-edited", "claude");
        edit.id = Some(first.id.clone());
        let second = upsert(&conn, &edit).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(second.name, "bar-edited");
    }

    #[test]
    fn empty_name_rejected() {
        let conn = open_in_memory();
        let mut bad = input("", "claude");
        bad.name = "   ".to_string();
        assert!(upsert(&conn, &bad).is_err());
    }

    #[test]
    fn empty_engine_rejected() {
        let conn = open_in_memory();
        let mut bad = input("baz", "");
        bad.engine_id = "".to_string();
        assert!(upsert(&conn, &bad).is_err());
    }

    #[test]
    fn delete_unknown_errors() {
        let conn = open_in_memory();
        assert!(delete(&conn, "nope").is_err());
    }

    #[test]
    fn upsert_open_link_requires_url() {
        let conn = open_in_memory();
        let mut link = input("link", "");
        link.entry_kind = "open_link".to_string();
        assert!(upsert(&conn, &link).is_err());
        link.entry_url = "https://example.com".to_string();
        let row = upsert(&conn, &link).unwrap();
        assert_eq!(row.entry_kind, "open_link");
        assert_eq!(row.entry_url, "https://example.com");
    }

    #[test]
    fn run_workflow_with_empty_workflow_id_is_allowed() {
        // 「直接派发执行」的 entryWorkflowId 改为可选：留空时走轻量 executeSession
        // （不入队），所以写入路径上必须允许 workflowId 为空。
        let conn = open_in_memory();
        let mut wf = input("wf", "claude");
        wf.entry_kind = "run_workflow".to_string();
        wf.entry_workflow_id = Some(String::new());
        let row = upsert(&conn, &wf).unwrap();
        assert_eq!(row.entry_kind, "run_workflow");
        assert_eq!(row.entry_workflow_id.as_deref(), Some(""));
    }
}
