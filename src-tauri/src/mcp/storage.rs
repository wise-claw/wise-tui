//! Storage adapter for the neutral `mcp_server` table.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::protocol::{McpServer, McpSource, McpTransport};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub name: String,
    pub transport: McpTransport,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_source")]
    pub source: McpSource,
}

fn default_enabled() -> bool {
    true
}
fn default_source() -> McpSource {
    McpSource::User
}

pub fn list(conn: &Connection) -> Result<Vec<McpServer>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, transport, enabled, source, created_at, updated_at \
             FROM mcp_server ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_server)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<McpServer>, String> {
    let row = conn
        .query_row(
            "SELECT id, name, transport, enabled, source, created_at, updated_at \
             FROM mcp_server WHERE id = ?1",
            params![id],
            row_to_server,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn upsert(conn: &Connection, input: &McpServerInput) -> Result<McpServer, String> {
    if input.name.trim().is_empty() {
        return Err("name must not be empty".to_string());
    }
    let now = Utc::now().to_rfc3339();
    let source_wire = input.source.to_wire();
    let transport_json = serde_json::to_string(&input.transport).map_err(|e| e.to_string())?;
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, created_at FROM mcp_server WHERE name = ?1 AND source = ?2",
            params![input.name, source_wire],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = match existing.as_ref() {
        Some((id, _)) => id.clone(),
        None => Uuid::new_v4().to_string(),
    };
    let created_at = existing
        .as_ref()
        .map(|(_, c)| c.clone())
        .unwrap_or_else(|| now.clone());
    conn.execute(
        "INSERT INTO mcp_server (id, name, transport, enabled, source, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(id) DO UPDATE SET \
           name = excluded.name, \
           transport = excluded.transport, \
           enabled = excluded.enabled, \
           source = excluded.source, \
           updated_at = excluded.updated_at",
        params![
            id,
            input.name,
            transport_json,
            if input.enabled { 1 } else { 0 },
            source_wire,
            created_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_by_id(conn, &id)?.ok_or_else(|| "row missing after upsert".to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM mcp_server WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("no mcp server with id {id}"));
    }
    Ok(())
}

fn row_to_server(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServer> {
    let transport_str: String = row.get(2)?;
    let transport = serde_json::from_str(&transport_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let source_wire: String = row.get(4)?;
    let source = McpSource::from_wire(&source_wire).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown McpSource '{source_wire}'"),
            )),
        )
    })?;
    let enabled: i64 = row.get(3)?;
    Ok(McpServer {
        id: row.get(0)?,
        name: row.get(1)?,
        transport,
        enabled: enabled != 0,
        source,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/025_mcp_server.sql"))
            .unwrap();
        conn
    }

    fn stdio_input(name: &str) -> McpServerInput {
        McpServerInput {
            name: name.to_string(),
            transport: McpTransport::Stdio {
                command: "claude-mcp".to_string(),
                args: vec![],
                env: BTreeMap::new(),
            },
            enabled: true,
            source: McpSource::User,
        }
    }

    #[test]
    fn upsert_inserts_then_lists() {
        let conn = open_in_memory();
        let row = upsert(&conn, &stdio_input("hello")).unwrap();
        assert_eq!(row.name, "hello");
        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, row.id);
    }

    #[test]
    fn upsert_with_same_name_and_source_keeps_id() {
        let conn = open_in_memory();
        let first = upsert(&conn, &stdio_input("hello")).unwrap();
        let mut second_input = stdio_input("hello");
        second_input.enabled = false;
        let second = upsert(&conn, &second_input).unwrap();
        assert_eq!(first.id, second.id);
        assert!(!second.enabled);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn different_source_with_same_name_creates_distinct_row() {
        let conn = open_in_memory();
        let first = upsert(&conn, &stdio_input("hello")).unwrap();
        let mut alt = stdio_input("hello");
        alt.source = McpSource::Extension("ext-a".to_string());
        let second = upsert(&conn, &alt).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn delete_removes_row() {
        let conn = open_in_memory();
        let row = upsert(&conn, &stdio_input("gone")).unwrap();
        delete(&conn, &row.id).unwrap();
        assert!(get_by_id(&conn, &row.id).unwrap().is_none());
    }

    #[test]
    fn delete_unknown_id_errors() {
        let conn = open_in_memory();
        assert!(delete(&conn, "nope").is_err());
    }

    #[test]
    fn name_must_not_be_empty() {
        let conn = open_in_memory();
        let mut input = stdio_input("hello");
        input.name = "   ".to_string();
        assert!(upsert(&conn, &input).is_err());
    }
}
