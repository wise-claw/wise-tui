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
}

pub fn list(conn: &Connection) -> Result<Vec<CustomAssistantRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, avatar_color, engine_id, system_prompt, model, created_at, updated_at
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
        "SELECT id, name, description, avatar_color, engine_id, system_prompt, model, created_at, updated_at
         FROM assistant_custom WHERE id = ?1",
        params![id],
        row_to_assistant,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert(conn: &Connection, input: &CustomAssistantInput) -> Result<CustomAssistantRow, String> {
    if input.name.trim().is_empty() {
        return Err("name must not be empty".to_string());
    }
    if input.engine_id.trim().is_empty() {
        return Err("engineId must not be empty".to_string());
    }
    let now = Utc::now().to_rfc3339();
    let (id, created_at) = match input.id.as_deref() {
        Some(existing_id) => match get_by_id(conn, existing_id)? {
            Some(prev) => (prev.id, prev.created_at),
            None => (existing_id.to_string(), now.clone()),
        },
        None => (Uuid::new_v4().to_string(), now.clone()),
    };
    conn.execute(
        "INSERT INTO assistant_custom (id, name, description, avatar_color, engine_id, system_prompt, model, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           avatar_color = excluded.avatar_color,
           engine_id = excluded.engine_id,
           system_prompt = excluded.system_prompt,
           model = excluded.model,
           updated_at = excluded.updated_at",
        params![
            id,
            input.name,
            input.description,
            input.avatar_color,
            input.engine_id,
            input.system_prompt,
            input.model,
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
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/026_assistant_custom.sql"))
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
        }
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
}
