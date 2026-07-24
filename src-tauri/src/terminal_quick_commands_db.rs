//! 终端快捷指令：SQLite `terminal_quick_commands` 表。

use crate::wise_db::{unix_now_ms, WiseDb};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const APP_SETTINGS_LEGACY_KEY: &str = "wise.terminalQuickCommands.v1";
const MAX_ITEMS: usize = 50;
const MAX_TITLE_LEN: usize = 80;
const MAX_COMMAND_LEN: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalQuickCommandDto {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

fn normalize_item(mut item: TerminalQuickCommandDto, sort_order: i32) -> Option<TerminalQuickCommandDto> {
    item.id = item.id.trim().to_string();
    item.title = item.title.trim().chars().take(MAX_TITLE_LEN).collect();
    item.command = item.command.trim().chars().take(MAX_COMMAND_LEN).collect();
    if item.id.is_empty() || item.command.is_empty() {
        return None;
    }
    item.sort_order = sort_order;
    Some(item)
}

fn normalize_items(items: Vec<TerminalQuickCommandDto>) -> Vec<TerminalQuickCommandDto> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in items {
        let Some(normalized) = normalize_item(item, out.len() as i32) else {
            continue;
        };
        if !seen.insert(normalized.id.clone()) {
            continue;
        }
        out.push(normalized);
        if out.len() >= MAX_ITEMS {
            break;
        }
    }
    out
}

fn list_conn(conn: &Connection) -> Result<Vec<TerminalQuickCommandDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, command, sort_order, created_at, updated_at
             FROM terminal_quick_commands
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TerminalQuickCommandDto {
                id: row.get(0)?,
                title: row.get(1)?,
                command: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let item = row.map_err(|e| e.to_string())?;
        if let Some(normalized) = normalize_item(item, items.len() as i32) {
            items.push(normalized);
        }
    }
    Ok(items)
}

fn replace_conn(conn: &Connection, items: &[TerminalQuickCommandDto]) -> Result<(), String> {
    let now = unix_now_ms();
    conn.execute("DELETE FROM terminal_quick_commands", [])
        .map_err(|e| e.to_string())?;
    for item in items {
        let created_at = if item.created_at > 0 {
            item.created_at
        } else {
            now
        };
        let updated_at = if item.updated_at > 0 {
            item.updated_at
        } else {
            now
        };
        conn.execute(
            "INSERT INTO terminal_quick_commands (
                id, title, command, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item.id,
                item.title,
                item.command,
                item.sort_order,
                created_at,
                updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将早期 `app_settings` JSON blob 迁入独立表后删除旧 key。
pub fn seed_migrate_terminal_quick_commands_from_app_settings(
    conn: &Connection,
) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM terminal_quick_commands",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        let _ = conn.execute(
            "DELETE FROM app_settings WHERE key = ?1",
            params![APP_SETTINGS_LEGACY_KEY],
        );
        return Ok(());
    }

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![APP_SETTINGS_LEGACY_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(raw) = raw {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            let mut parsed = Vec::new();
            if let Some(arr) = value.as_array() {
                for entry in arr {
                    let id = entry
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let title = entry
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let command = entry
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    parsed.push(TerminalQuickCommandDto {
                        id,
                        title,
                        command,
                        sort_order: 0,
                        created_at: 0,
                        updated_at: 0,
                    });
                }
            }
            let normalized = normalize_items(parsed);
            if !normalized.is_empty() {
                replace_conn(conn, &normalized)?;
            }
        }
    }

    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![APP_SETTINGS_LEGACY_KEY],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl WiseDb {
    pub fn list_terminal_quick_commands(&self) -> Result<Vec<TerminalQuickCommandDto>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_conn(&g)
    }

    pub fn save_terminal_quick_commands(
        &self,
        items: Vec<TerminalQuickCommandDto>,
    ) -> Result<Vec<TerminalQuickCommandDto>, String> {
        let normalized = normalize_items(items);
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        replace_conn(&tx, &normalized)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(include_str!("../migrations/050_terminal_quick_commands.sql"))
            .expect("migrate");
        conn
    }

    #[test]
    fn replace_and_list_roundtrip() {
        let conn = setup();
        let items = normalize_items(vec![
            TerminalQuickCommandDto {
                id: "a".into(),
                title: "状态".into(),
                command: "git status".into(),
                sort_order: 0,
                created_at: 0,
                updated_at: 0,
            },
            TerminalQuickCommandDto {
                id: "b".into(),
                title: "".into(),
                command: "pwd".into(),
                sort_order: 0,
                created_at: 0,
                updated_at: 0,
            },
        ]);
        replace_conn(&conn, &items).expect("save");
        let listed = list_conn(&conn).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "a");
        assert_eq!(listed[0].command, "git status");
        assert_eq!(listed[1].id, "b");
        assert_eq!(listed[1].sort_order, 1);
    }

    #[test]
    fn seed_migrates_app_settings_blob() {
        let conn = setup();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );",
        )
        .expect("app_settings");
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
            params![
                APP_SETTINGS_LEGACY_KEY,
                r#"[{"id":"x","title":"拉取","command":"git pull"}]"#
            ],
        )
        .expect("insert legacy");

        seed_migrate_terminal_quick_commands_from_app_settings(&conn).expect("seed");
        let listed = list_conn(&conn).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].command, "git pull");

        let leftover: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
                params![APP_SETTINGS_LEGACY_KEY],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(leftover, 0);
    }
}
