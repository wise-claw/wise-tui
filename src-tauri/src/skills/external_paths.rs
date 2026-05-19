//! User-added external skill paths persisted in SQLite.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPathRow {
    pub id: String,
    pub path: String,
    pub added_at: String,
}

pub fn list(conn: &Connection) -> Result<Vec<ExternalPathRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, path, added_at FROM skills_external_path ORDER BY added_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ExternalPathRow {
                id: row.get(0)?,
                path: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn insert(conn: &Connection, path: &str) -> Result<ExternalPathRow, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path must not be empty".to_string());
    }
    // Reject if a row with the same path already exists (UNIQUE constraint
    // would also fail, but we want a friendly error).
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM skills_external_path WHERE path = ?1",
            params![trimmed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existing.is_some() {
        return Err(format!("path already registered: {trimmed}"));
    }
    let row = ExternalPathRow {
        id: Uuid::new_v4().to_string(),
        path: trimmed.to_string(),
        added_at: Utc::now().to_rfc3339(),
    };
    conn.execute(
        "INSERT INTO skills_external_path (id, path, added_at) VALUES (?1, ?2, ?3)",
        params![row.id, row.path, row.added_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM skills_external_path WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("no external path with id {id}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!(
            "../../migrations/024_skills_external_path.sql"
        ))
        .unwrap();
        conn
    }

    #[test]
    fn round_trip_insert_list_delete() {
        let conn = open_in_memory();
        let row = insert(&conn, "/tmp/skills").unwrap();
        let back = list(&conn).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].path, "/tmp/skills");
        delete(&conn, &row.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn duplicate_insert_rejected() {
        let conn = open_in_memory();
        insert(&conn, "/tmp/skills").unwrap();
        let err = insert(&conn, "/tmp/skills").unwrap_err();
        assert!(err.contains("already registered"));
    }

    #[test]
    fn delete_unknown_id_errors() {
        let conn = open_in_memory();
        let err = delete(&conn, "nope").unwrap_err();
        assert!(err.contains("no external path"));
    }

    #[test]
    fn empty_path_rejected() {
        let conn = open_in_memory();
        assert!(insert(&conn, "   ").is_err());
    }
}
