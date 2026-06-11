//! Soft-delete registry for builtin / extension assistants (and custom tombstones).

use chrono::Utc;
use rusqlite::{params, Connection};
use std::collections::HashSet;

pub fn list_hidden_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT assistant_id FROM assistant_hidden")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn hide(conn: &Connection, assistant_id: &str) -> Result<(), String> {
    let id = assistant_id.trim();
    if id.is_empty() {
        return Err("assistant id must not be empty".into());
    }
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO assistant_hidden (assistant_id, hidden_at) VALUES (?1, ?2)
         ON CONFLICT(assistant_id) DO UPDATE SET hidden_at = excluded.hidden_at",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/038_assistant_hidden.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn hide_and_list_round_trip() {
        let conn = open_in_memory();
        hide(&conn, "custom:writer").unwrap();
        hide(&conn, "ext-polish").unwrap();
        let hidden = list_hidden_ids(&conn).unwrap();
        assert!(hidden.contains("custom:writer"));
        assert!(hidden.contains("ext-polish"));
    }
}
