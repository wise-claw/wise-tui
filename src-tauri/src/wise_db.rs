//! SQLite（rusqlite）+ `migrations/` 内 SQL 顺序执行。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseMessageListItem {
    pub id: String,
    pub conversation_id: String,
    pub body: String,
    pub created_at: String,
    pub read_at: Option<String>,
}

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_mascot_prefs_toast.sql");
const MIGRATION_003: &str = include_str!("../migrations/003_projects_and_settings.sql");
const MIGRATION_004: &str = include_str!("../migrations/004_prd_task_split_results.sql");
const MIGRATION_006: &str = include_str!("../migrations/006_workflow_store.sql");
const MIGRATION_007: &str = include_str!("../migrations/007_employee_workflow.sql");
const MIGRATION_008: &str = include_str!("../migrations/008_employee_repository_mapping.sql");
const MIGRATION_009: &str = include_str!("../migrations/009_employee_display_order.sql");
const MIGRATION_010: &str = include_str!("../migrations/010_workflow_graph.sql");
const MIGRATION_011: &str = include_str!("../migrations/011_task_event_acceptance_idempotency.sql");
const MIGRATION_012: &str = include_str!("../migrations/012_prd_executable_tasks.sql");
const MIGRATION_013: &str = include_str!("../migrations/013_project_icon_badge.sql");
const MIGRATION_014: &str = include_str!("../migrations/014_project_repository_display_order.sql");
const MIGRATION_015: &str = include_str!("../migrations/015_project_prd_scope.sql");
const MIGRATION_016: &str = include_str!("../migrations/016_seed_default_employees.sql");
const PLATFORM_SPLIT_PROMPT_SEED_JSON: &str =
    include_str!("../migrations/005_platform_split_prompt_seed.json");

enum MigrationAction {
    Sql(&'static str),
    Seed(fn(&Connection) -> Result<(), String>),
}

struct Migration {
    name: &'static str,
    action: MigrationAction,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        name: "001_init",
        action: MigrationAction::Sql(MIGRATION_001),
    },
    Migration {
        name: "002_mascot_prefs_toast",
        action: MigrationAction::Sql(MIGRATION_002),
    },
    Migration {
        name: "003_projects_and_settings",
        action: MigrationAction::Sql(MIGRATION_003),
    },
    Migration {
        name: "004_prd_task_split_results",
        action: MigrationAction::Sql(MIGRATION_004),
    },
    Migration {
        name: "005_platform_split_prompt_default",
        action: MigrationAction::Seed(seed_platform_split_prompt_default),
    },
    Migration {
        name: "006_workflow_store",
        action: MigrationAction::Sql(MIGRATION_006),
    },
    Migration {
        name: "007_employee_workflow",
        action: MigrationAction::Sql(MIGRATION_007),
    },
    Migration {
        name: "008_employee_repository_mapping",
        action: MigrationAction::Sql(MIGRATION_008),
    },
    Migration {
        name: "009_employee_display_order",
        action: MigrationAction::Sql(MIGRATION_009),
    },
    Migration {
        name: "010_workflow_graph",
        action: MigrationAction::Sql(MIGRATION_010),
    },
    Migration {
        name: "011_task_event_acceptance_idempotency",
        action: MigrationAction::Sql(MIGRATION_011),
    },
    Migration {
        name: "012_prd_executable_tasks",
        action: MigrationAction::Sql(MIGRATION_012),
    },
    Migration {
        name: "013_project_icon_badge",
        action: MigrationAction::Sql(MIGRATION_013),
    },
    Migration {
        name: "014_project_repository_display_order",
        action: MigrationAction::Sql(MIGRATION_014),
    },
    Migration {
        name: "015_project_prd_scope",
        action: MigrationAction::Sql(MIGRATION_015),
    },
    Migration {
        name: "016_seed_default_employees",
        action: MigrationAction::Sql(MIGRATION_016),
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseProjectRow {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub icon_display_name: Option<String>,
    pub icon_color: Option<String>,
    pub repository_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseEmployeeRow {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub display_order: i64,
    pub repository_ids: Vec<i64>,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseEmployeeTaskCountRow {
    pub employee_id: String,
    pub task_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseWorkflowTemplateRow {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub stage_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseWorkflowStageRow {
    pub id: String,
    pub workflow_id: String,
    pub name: String,
    pub stage_order: i64,
    pub pass_rule: String,
    pub reject_rule: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseStageAssigneeRow {
    pub id: String,
    pub stage_id: String,
    pub employee_id: String,
    pub required_count: i64,
    pub is_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseWorkflowGraphRow {
    pub workflow_id: String,
    pub version: i64,
    pub graph_json: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct WiseDb(pub Mutex<Connection>);

impl WiseDb {
    pub fn open() -> Result<Self, String> {
        let dir = crate::wise_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path: PathBuf = dir.join("wise.db");
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        run_migrations(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn unread_total(&self) -> Result<i64, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let n: i64 = g
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE read_at IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(n)
    }

    pub fn mascot_position_opt(&self) -> Result<Option<(i32, i32)>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare("SELECT window_x, window_y FROM mascot_prefs WHERE id = 1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let x: Option<i32> = row.get(0).map_err(|e| e.to_string())?;
            let y: Option<i32> = row.get(1).map_err(|e| e.to_string())?;
            return Ok(match (x, y) {
                (Some(x), Some(y)) => Some((x, y)),
                _ => None,
            });
        }
        Ok(None)
    }

    pub fn save_mascot_position(&self, x: i32, y: i32) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "UPDATE mascot_prefs SET window_x = ?1, window_y = ?2 WHERE id = 1",
            params![x, y],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_mascot_visible_pref(&self, visible: bool) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "UPDATE mascot_prefs SET visible = ?1 WHERE id = 1",
            params![if visible { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mascot_visible_pref(&self) -> Result<bool, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let v: i64 = g
            .query_row("SELECT visible FROM mascot_prefs WHERE id = 1", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        Ok(v != 0)
    }

    /// 返回是否新插入一行（`server_msg_id` 重复时为 false）。
    pub fn ingest_inbound(
        &self,
        conversation_id: &str,
        body: &str,
        server_msg_id: Option<&str>,
    ) -> Result<bool, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        if let Some(sid) = server_msg_id {
            let n = g
                .execute(
                    "INSERT OR IGNORE INTO messages (id, conversation_id, direction, server_msg_id, body)
                     VALUES (?1, ?2, 'inbound', ?3, ?4)",
                    params![id, conversation_id, sid, body],
                )
                .map_err(|e| e.to_string())?;
            return Ok(n > 0);
        }
        g.execute(
            "INSERT INTO messages (id, conversation_id, direction, server_msg_id, body)
                 VALUES (?1, ?2, 'inbound', NULL, ?3)",
            params![id, conversation_id, body],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub fn mascot_toast_merge_ms(&self) -> Result<u64, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let v: i64 = g
            .query_row(
                "SELECT COALESCE(toast_merge_ms, 80) FROM mascot_prefs WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(v.max(0) as u64)
    }

    /// 当前处于勿扰窗口内则返回 true（仅用于抑制气泡，不阻止入库）。
    pub fn mascot_dnd_active(&self) -> Result<bool, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let until: Option<i64> = g
            .query_row(
                "SELECT dnd_until_ms FROM mascot_prefs WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let Some(u) = until else {
            return Ok(false);
        };
        let now = unix_now_ms();
        Ok(now < u)
    }

    pub fn mark_all_read(&self) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "UPDATE messages SET read_at = datetime('now') WHERE read_at IS NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 将单条入站消息标为已读（`id` 为 `messages.id`）。
    pub fn mark_inbound_read_by_id(&self, message_id: &str) -> Result<(), String> {
        let id = message_id.trim();
        if id.is_empty() {
            return Ok(());
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "UPDATE messages SET read_at = datetime('now')
             WHERE id = ?1 AND direction = 'inbound' AND read_at IS NULL",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 将直连批量 OMC 写入的入站通知标为已读（按 `server_msg_id` 前缀与 `batch_epoch` 限定，避免误标其它通知）。
    pub fn mark_inbound_read_omc_direct_batch_for_conversations_epoch(
        &self,
        conversation_ids: &[String],
        batch_epoch: i64,
    ) -> Result<u64, String> {
        let epoch = batch_epoch.to_string();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut total: u64 = 0;
        for raw in conversation_ids {
            let cid = raw.trim();
            if cid.is_empty() {
                continue;
            }
            let n = g
                .execute(
                    "UPDATE messages SET read_at = datetime('now')
                     WHERE direction = 'inbound' AND read_at IS NULL AND conversation_id = ?1
                     AND server_msg_id IS NOT NULL
                     AND (
                       server_msg_id LIKE ('omc-direct-batch:' || ?2 || ':%')
                       OR server_msg_id LIKE ('omc-direct-batch:cc-inv:' || ?2 || ':%')
                     )",
                    params![cid, &epoch],
                )
                .map_err(|e| e.to_string())?;
            total += n as u64;
        }
        Ok(total)
    }

    /// 最近入库的入站消息（桌面通知 / 推送等），用于主窗口通知中心列表。
    pub fn list_inbound_recent(&self, limit: i64) -> Result<Vec<WiseMessageListItem>, String> {
        let lim = limit.clamp(1, 200);
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, conversation_id, body, created_at, read_at
                 FROM messages
                 WHERE direction = 'inbound'
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![lim], |row| {
                Ok(WiseMessageListItem {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    body: row.get(2)?,
                    created_at: row.get(3)?,
                    read_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_projects(&self) -> Result<Vec<WiseProjectRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, name, created_at, updated_at, icon_display_name, icon_color
                 FROM projects
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            let (id, name, created_at, updated_at, icon_display_name, icon_color) =
                r.map_err(|e| e.to_string())?;
            let mut links_stmt = g
                .prepare(
                    "SELECT repository_id
                     FROM project_repositories
                     WHERE project_id = ?1
                     ORDER BY display_order ASC, created_at ASC, repository_id ASC",
                )
                .map_err(|e| e.to_string())?;
            let links = links_stmt
                .query_map(params![&id], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut repository_ids = Vec::new();
            for link in links {
                repository_ids.push(link.map_err(|e| e.to_string())?);
            }
            out.push(WiseProjectRow {
                id,
                name,
                created_at,
                updated_at,
                icon_display_name,
                icon_color,
                repository_ids,
            });
        }
        Ok(out)
    }

    pub fn list_employees(&self) -> Result<Vec<WiseEmployeeRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, name, agent_type, enabled, created_at, updated_at, display_order
                 FROM employees
                 ORDER BY display_order ASC, created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WiseEmployeeRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    agent_type: row.get(2)?,
                    enabled: row.get::<_, i64>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    display_order: row.get(6)?,
                    repository_ids: Vec::new(),
                    project_ids: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            let mut row = item.map_err(|e| e.to_string())?;
            let mut rel_stmt = g
                .prepare(
                    "SELECT repository_id
                     FROM employee_repositories
                     WHERE employee_id = ?1
                     ORDER BY created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let rel_rows = rel_stmt
                .query_map(params![row.id.clone()], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut repository_ids = Vec::new();
            for rel in rel_rows {
                repository_ids.push(rel.map_err(|e| e.to_string())?);
            }
            row.repository_ids = repository_ids;

            let mut proj_stmt = g
                .prepare(
                    "SELECT project_id
                     FROM project_prd_employees
                     WHERE employee_id = ?1
                     ORDER BY created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let proj_rows = proj_stmt
                .query_map(params![row.id.clone()], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut project_ids = Vec::new();
            for proj in proj_rows {
                project_ids.push(proj.map_err(|e| e.to_string())?);
            }
            row.project_ids = project_ids;

            out.push(row);
        }
        Ok(out)
    }

    pub fn create_employee(
        &self,
        id: &str,
        name: &str,
        agent_type: &str,
        enabled: bool,
        now_ms: i64,
        repository_ids: &[i64],
    ) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO employees (id, name, agent_type, enabled, created_at, updated_at, display_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, agent_type, if enabled { 1 } else { 0 }, now_ms, now_ms, now_ms],
        )
        .map_err(|e| e.to_string())?;
        for repository_id in repository_ids {
            tx.execute(
                "INSERT OR IGNORE INTO employee_repositories (employee_id, repository_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![id, repository_id, now_ms],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_employee(
        &self,
        id: &str,
        name: &str,
        agent_type: &str,
        enabled: bool,
        now_ms: i64,
        repository_ids: &[i64],
    ) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        let n = tx
            .execute(
                "UPDATE employees
                 SET name = ?1, agent_type = ?2, enabled = ?3, updated_at = ?4
                 WHERE id = ?5",
                params![name, agent_type, if enabled { 1 } else { 0 }, now_ms, id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("员工未找到".to_string());
        }
        tx.execute(
            "DELETE FROM employee_repositories WHERE employee_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        for repository_id in repository_ids {
            tx.execute(
                "INSERT OR IGNORE INTO employee_repositories (employee_id, repository_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![id, repository_id, now_ms],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_employee(&self, id: &str) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let referenced: i64 = g
            .query_row(
                "SELECT COUNT(*) FROM stage_assignees WHERE employee_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if referenced > 0 {
            return Err("员工已被工作流阶段引用，无法删除".to_string());
        }
        let n = g
            .execute("DELETE FROM employees WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("员工未找到".to_string());
        }
        Ok(())
    }

    pub fn move_employee_display_order(&self, id: &str, direction: &str) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;

        let current: Option<(String, i64)> = tx
            .query_row(
                "SELECT id, display_order FROM employees WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((current_id, current_order)) = current else {
            return Err("员工未找到".to_string());
        };

        let neighbor_sql = if direction == "up" {
            "SELECT id, display_order
             FROM employees
             WHERE display_order < ?1
             ORDER BY display_order DESC
             LIMIT 1"
        } else if direction == "down" {
            "SELECT id, display_order
             FROM employees
             WHERE display_order > ?1
             ORDER BY display_order ASC
             LIMIT 1"
        } else {
            return Err("direction 仅支持 up/down".to_string());
        };

        let neighbor: Option<(String, i64)> = tx
            .query_row(neighbor_sql, params![current_order], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;

        let Some((neighbor_id, neighbor_order)) = neighbor else {
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(());
        };

        tx.execute(
            "UPDATE employees SET display_order = ?1 WHERE id = ?2",
            params![neighbor_order, current_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE employees SET display_order = ?1 WHERE id = ?2",
            params![current_order, neighbor_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_employee_task_counts(&self) -> Result<Vec<WiseEmployeeTaskCountRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT e.id, COUNT(DISTINCT d.task_id) AS task_count
                 FROM employees e
                 LEFT JOIN task_stage_decisions d
                   ON d.employee_id = e.id
                  AND d.decision = 'pending'
                 LEFT JOIN tasks t
                   ON t.id = d.task_id
                  AND t.status = 'in_progress'
                 GROUP BY e.id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WiseEmployeeTaskCountRow {
                    employee_id: row.get(0)?,
                    task_count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_workflow_templates(&self) -> Result<Vec<WiseWorkflowTemplateRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT w.id, w.name, w.is_default, COUNT(s.id) AS stage_count, w.created_at, w.updated_at
                 FROM workflows w
                 LEFT JOIN workflow_stages s ON s.workflow_id = w.id
                 GROUP BY w.id
                 ORDER BY w.updated_at DESC, w.created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WiseWorkflowTemplateRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_default: row.get::<_, i64>(2)? != 0,
                    stage_count: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_workflow_stages(
        &self,
        workflow_id: &str,
    ) -> Result<Vec<WiseWorkflowStageRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, workflow_id, name, stage_order, pass_rule, reject_rule
                 FROM workflow_stages
                 WHERE workflow_id = ?1
                 ORDER BY stage_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workflow_id], |row| {
                Ok(WiseWorkflowStageRow {
                    id: row.get(0)?,
                    workflow_id: row.get(1)?,
                    name: row.get(2)?,
                    stage_order: row.get(3)?,
                    pass_rule: row.get(4)?,
                    reject_rule: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_stage_assignees(
        &self,
        stage_ids: &[String],
    ) -> Result<Vec<WiseStageAssigneeRow>, String> {
        if stage_ids.is_empty() {
            return Ok(Vec::new());
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut out = Vec::new();
        for stage_id in stage_ids {
            let mut stmt = g
                .prepare(
                    "SELECT id, stage_id, employee_id, required_count, is_required
                     FROM stage_assignees
                     WHERE stage_id = ?1
                     ORDER BY rowid ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![stage_id], |row| {
                    Ok(WiseStageAssigneeRow {
                        id: row.get(0)?,
                        stage_id: row.get(1)?,
                        employee_id: row.get(2)?,
                        required_count: row.get(3)?,
                        is_required: row.get::<_, i64>(4)? != 0,
                    })
                })
                .map_err(|e| e.to_string())?;
            for item in rows {
                out.push(item.map_err(|e| e.to_string())?);
            }
        }
        Ok(out)
    }

    pub fn upsert_workflow_template(
        &self,
        workflow_id: &str,
        name: &str,
        is_default: bool,
        now_ms: i64,
        stages: &[WiseWorkflowStageRow],
        assignees: &[WiseStageAssigneeRow],
    ) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        if is_default {
            tx.execute("UPDATE workflows SET is_default = 0", [])
                .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO workflows (id, name, is_default, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               is_default = excluded.is_default,
               updated_at = excluded.updated_at",
            params![
                workflow_id,
                name,
                if is_default { 1 } else { 0 },
                now_ms,
                now_ms
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM stage_assignees WHERE stage_id IN (SELECT id FROM workflow_stages WHERE workflow_id = ?1)",
            params![workflow_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM workflow_stages WHERE workflow_id = ?1",
            params![workflow_id],
        )
        .map_err(|e| e.to_string())?;
        for stage in stages {
            tx.execute(
                "INSERT INTO workflow_stages (id, workflow_id, name, stage_order, pass_rule, reject_rule)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    stage.id,
                    workflow_id,
                    stage.name,
                    stage.stage_order,
                    stage.pass_rule,
                    stage.reject_rule
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        for assignee in assignees {
            tx.execute(
                "INSERT INTO stage_assignees (id, stage_id, employee_id, required_count, is_required)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    assignee.id,
                    assignee.stage_id,
                    assignee.employee_id,
                    assignee.required_count,
                    if assignee.is_required { 1 } else { 0 }
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_workflow_template(&self, workflow_id: &str) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        let in_progress_task_refs: i64 = tx
            .query_row(
                "SELECT COUNT(*)
                 FROM tasks t
                 WHERE t.workflow_id = ?1
                   AND t.status = 'in_progress'
                   AND EXISTS (
                     SELECT 1
                     FROM workflow_stages s
                     JOIN task_stage_decisions d ON d.stage_id = s.id
                     WHERE s.workflow_id = t.workflow_id
                       AND s.stage_order = t.current_stage_index
                       AND d.task_id = t.id
                       AND d.decision = 'pending'
                   )",
                params![workflow_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if in_progress_task_refs > 0 {
            let mut stmt = tx
                .prepare(
                    "SELECT t.title, t.creator
                     FROM tasks t
                     WHERE t.workflow_id = ?1
                       AND t.status = 'in_progress'
                       AND EXISTS (
                         SELECT 1
                         FROM workflow_stages s
                         JOIN task_stage_decisions d ON d.stage_id = s.id
                         WHERE s.workflow_id = t.workflow_id
                           AND s.stage_order = t.current_stage_index
                           AND d.task_id = t.id
                           AND d.decision = 'pending'
                       )
                     ORDER BY t.updated_at DESC
                     LIMIT 3",
                )
                .map_err(|e| e.to_string())?;
            let blocker_rows = stmt
                .query_map(params![workflow_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let mut blocker_labels = Vec::new();
            for row in blocker_rows {
                let (title, creator) = row.map_err(|e| e.to_string())?;
                blocker_labels.push(format!("{}（创建者：{}）", title, creator));
            }
            if !blocker_labels.is_empty() {
                return Err(format!(
                    "工作流存在 {} 个进行中任务（可能来自其他会话），无法删除。示例任务：{}",
                    in_progress_task_refs,
                    blocker_labels.join("；")
                ));
            }
            return Err(format!(
                "工作流存在 {} 个进行中任务（可能来自其他会话），无法删除",
                in_progress_task_refs
            ));
        }
        tx.execute(
            "DELETE FROM tasks WHERE workflow_id = ?1",
            params![workflow_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM stage_assignees WHERE stage_id IN (SELECT id FROM workflow_stages WHERE workflow_id = ?1)",
            params![workflow_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM workflow_stages WHERE workflow_id = ?1",
            params![workflow_id],
        )
        .map_err(|e| e.to_string())?;
        let n = tx
            .execute("DELETE FROM workflows WHERE id = ?1", params![workflow_id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("工作流未找到".to_string());
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn create_project(
        &self,
        id: &str,
        name: &str,
        icon_display_name: Option<&str>,
        icon_color: Option<&str>,
        now_ms: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO projects (id, name, created_at, updated_at, icon_display_name, icon_color)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, now_ms, now_ms, icon_display_name, icon_color],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_project_icon_badge(
        &self,
        id: &str,
        icon_display_name: Option<&str>,
        icon_color: Option<&str>,
        now_ms: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let n = g
            .execute(
                "UPDATE projects SET icon_display_name = ?1, icon_color = ?2, updated_at = ?3 WHERE id = ?4",
                params![icon_display_name, icon_color, now_ms, id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("项目未找到".to_string());
        }
        Ok(())
    }

    pub fn update_project_name(&self, id: &str, name: &str, now_ms: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let n = g
            .execute(
                "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now_ms, id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("项目未找到".to_string());
        }
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM project_repositories WHERE project_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        let n = g
            .execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("项目未找到".to_string());
        }
        Ok(())
    }

    pub fn list_project_prd_employee_ids(&self, project_id: &str) -> Result<Vec<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT employee_id FROM project_prd_employees
                 WHERE project_id = ?1
                 ORDER BY created_at ASC, employee_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_project_prd_workflow_ids(&self, project_id: &str) -> Result<Vec<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT workflow_id FROM project_prd_workflows
                 WHERE project_id = ?1
                 ORDER BY created_at ASC, workflow_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn add_project_prd_employee(&self, project_id: &str, employee_id: &str, now_ms: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let exists: i64 = g
            .query_row("SELECT COUNT(*) FROM projects WHERE id = ?1", params![project_id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("项目未找到".into());
        }
        let emp: i64 = g
            .query_row(
                "SELECT COUNT(*) FROM employees WHERE id = ?1",
                params![employee_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if emp == 0 {
            return Err("员工未找到".into());
        }
        g.execute(
            "INSERT OR IGNORE INTO project_prd_employees (project_id, employee_id, created_at) VALUES (?1, ?2, ?3)",
            params![project_id, employee_id, now_ms],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_project_prd_employee(&self, project_id: &str, employee_id: &str, now_ms: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM project_prd_employees WHERE project_id = ?1 AND employee_id = ?2",
            params![project_id, employee_id],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_project_prd_workflow(&self, project_id: &str, workflow_id: &str, now_ms: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let exists: i64 = g
            .query_row("SELECT COUNT(*) FROM projects WHERE id = ?1", params![project_id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("项目未找到".into());
        }
        let wf: i64 = g
            .query_row(
                "SELECT COUNT(*) FROM workflows WHERE id = ?1",
                params![workflow_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if wf == 0 {
            return Err("团队未找到".into());
        }
        g.execute(
            "INSERT OR IGNORE INTO project_prd_workflows (project_id, workflow_id, created_at) VALUES (?1, ?2, ?3)",
            params![project_id, workflow_id, now_ms],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_project_prd_workflow(&self, project_id: &str, workflow_id: &str, now_ms: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM project_prd_workflows WHERE project_id = ?1 AND workflow_id = ?2",
            params![project_id, workflow_id],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_workflow_project_ids(&self, workflow_id: &str) -> Result<Vec<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT project_id FROM project_prd_workflows
                 WHERE workflow_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workflow_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn add_repository_to_project(
        &self,
        project_id: &str,
        repository_id: i64,
        now_ms: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT OR IGNORE INTO project_repositories (project_id, repository_id, created_at, display_order)
             SELECT ?1, ?2, ?3,
                    COALESCE((SELECT MAX(pr.display_order) FROM project_repositories pr WHERE pr.project_id = ?1), -1) + 1",
            params![project_id, repository_id, now_ms],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reorder_project_repositories(
        &self,
        project_id: &str,
        ordered_repository_ids: &[i64],
        now_ms: i64,
    ) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let tx = g.transaction().map_err(|e| e.to_string())?;
        let mut stmt = tx
            .prepare(
                "SELECT repository_id
                 FROM project_repositories
                 WHERE project_id = ?1
                 ORDER BY display_order ASC, created_at ASC, repository_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let current: Vec<i64> = stmt
            .query_map(params![project_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        if current.len() != ordered_repository_ids.len() {
            return Err("仓库数量与项目不一致".to_string());
        }
        let mut a = current.clone();
        let mut b = ordered_repository_ids.to_vec();
        a.sort_unstable();
        b.sort_unstable();
        if a != b {
            return Err("仓库集合与项目不匹配".to_string());
        }

        for (ord, rid) in ordered_repository_ids.iter().enumerate() {
            let n = tx
                .execute(
                    "UPDATE project_repositories
                     SET display_order = ?1
                     WHERE project_id = ?2 AND repository_id = ?3",
                    params![ord as i64, project_id, rid],
                )
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("项目仓库关联未找到".to_string());
            }
        }
        tx.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_repository_from_project(
        &self,
        project_id: &str,
        repository_id: i64,
        now_ms: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM project_repositories WHERE project_id = ?1 AND repository_id = ?2",
            params![project_id, repository_id],
        )
        .map_err(|e| e.to_string())?;
        g.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_repository_from_all_projects(&self, repository_id: i64) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM project_repositories WHERE repository_id = ?1",
            params![repository_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let value: String = row.get(0).map_err(|e| e.to_string())?;
            Ok(Some(value))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 读取当前 PRD 任务拆分 JSON；若新表无数据则尝试从旧版 `app_settings` 迁移一行。
    pub fn get_prd_task_split_payload(&self) -> Result<Option<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let from_table: Option<String> = g
            .query_row(
                "SELECT payload FROM prd_task_split_results WHERE id = 'current'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if from_table.is_some() {
            return Ok(from_table);
        }
        let old: Option<String> = g
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'prd_task_split_result'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(payload) = old {
            let now = unix_now_ms();
            g.execute(
                "INSERT INTO prd_task_split_results (id, payload, updated_at) VALUES ('current', ?1, ?2)",
                params![&payload, now],
            )
            .map_err(|e| e.to_string())?;
            g.execute(
                "DELETE FROM app_settings WHERE key = 'prd_task_split_result'",
                [],
            )
            .map_err(|e| e.to_string())?;
            return Ok(Some(payload));
        }
        Ok(None)
    }

    pub fn clear_prd_task_split_payload(&self) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "DELETE FROM prd_task_split_results WHERE id = 'current'",
            [],
        )
        .map_err(|e| e.to_string())?;
        g.execute("DELETE FROM prd_executable_tasks WHERE id = 'current'", [])
            .map_err(|e| e.to_string())?;
        g.execute(
            "DELETE FROM app_settings WHERE key = 'prd_task_split_result'",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 读取可执行任务 JSON（与 `prd_task_split_results` 分表）。
    pub fn get_prd_executable_tasks_payload(&self) -> Result<Option<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.query_row(
            "SELECT payload FROM prd_executable_tasks WHERE id = 'current'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// 原子写入拆分结果与可执行任务两张表。
    pub fn set_prd_task_split_and_executable_payloads(
        &self,
        split_payload: &str,
        executable_payload: &str,
    ) -> Result<(), String> {
        let mut g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let now = unix_now_ms();
        let tx = g.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO prd_task_split_results (id, payload, updated_at) VALUES ('current', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![split_payload, now],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO prd_executable_tasks (id, payload, updated_at) VALUES ('current', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![executable_payload, now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_workflow_run_payload(
        &self,
        workflow_run_id: &str,
        session_id: &str,
        repository_path: &str,
        payload: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO workflow_runs (workflow_run_id, session_id, repository_path, payload, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(workflow_run_id)
             DO UPDATE SET
               session_id = excluded.session_id,
               repository_path = excluded.repository_path,
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![workflow_run_id, session_id, repository_path, payload, updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_workflow_run_payload(
        &self,
        workflow_run_id: &str,
    ) -> Result<Option<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let payload: Option<String> = g
            .query_row(
                "SELECT payload FROM workflow_runs WHERE workflow_run_id = ?1",
                params![workflow_run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(payload)
    }

    /// 仅用于「列举运行」等场景：按时间倒序，限制条数，避免全表大 payload 进内存。
    pub fn list_workflow_run_payloads(&self, limit: i64) -> Result<Vec<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let cap = limit.clamp(1, 2000);
        let mut stmt = g
            .prepare("SELECT payload FROM workflow_runs ORDER BY updated_at DESC LIMIT ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cap], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Claude 标签从临时 id 合并为 `session_id` 后，同步工作流库中的会话引用，保证 OMC 批量 / 团队任务与「执行详情」跳转仍可用。
    pub fn migrate_claude_tab_session_references(
        &self,
        from_tab_id: &str,
        to_session_id: &str,
    ) -> Result<(), String> {
        let from = from_tab_id.trim();
        let to = to_session_id.trim();
        if from.is_empty() || to.is_empty() || from == to {
            return Ok(());
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;

        g.execute(
            "UPDATE tasks SET creator = ?2 WHERE creator = ?1",
            params![from, to],
        )
        .map_err(|e| e.to_string())?;

        let collected: Vec<(String, String, String, i64)> = {
            let mut stmt = g
                .prepare(
                    "SELECT workflow_run_id, repository_path, payload, updated_at FROM workflow_runs WHERE session_id = ?1",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![from], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        for (workflow_run_id, _repository_path, payload, updated_at) in collected {
            let mut v: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            if let Some(obj) = v.as_object_mut() {
                obj.insert("sessionId".to_string(), Value::String(to.to_string()));
            }
            let new_payload = serde_json::to_string(&v).map_err(|e| e.to_string())?;
            g.execute(
                "UPDATE workflow_runs SET session_id = ?1, payload = ?2, updated_at = ?3 WHERE workflow_run_id = ?4",
                params![to, new_payload, updated_at, workflow_run_id],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub fn append_workflow_event_payload(
        &self,
        event_id: &str,
        workflow_run_id: &str,
        timestamp: i64,
        payload: &str,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT OR IGNORE INTO workflow_events (event_id, workflow_run_id, timestamp, payload)
             VALUES (?1, ?2, ?3, ?4)",
            params![event_id, workflow_run_id, timestamp, payload],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_workflow_event_payloads(
        &self,
        workflow_run_id: &str,
        from: Option<i64>,
        until: Option<i64>,
    ) -> Result<Vec<String>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT payload FROM workflow_events
                 WHERE workflow_run_id = ?1
                   AND (?2 IS NULL OR timestamp >= ?2)
                   AND (?3 IS NULL OR timestamp <= ?3)
                 ORDER BY timestamp ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workflow_run_id, from, until], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_workflow_graph(
        &self,
        workflow_id: &str,
    ) -> Result<Option<WiseWorkflowGraphRow>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let row = g
            .query_row(
                "SELECT workflow_id, version, graph_json, status, created_at, updated_at
                 FROM workflow_graphs
                 WHERE workflow_id = ?1",
                params![workflow_id],
                |row| {
                    Ok(WiseWorkflowGraphRow {
                        workflow_id: row.get(0)?,
                        version: row.get(1)?,
                        graph_json: row.get(2)?,
                        status: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub fn upsert_workflow_graph(
        &self,
        workflow_id: &str,
        version: i64,
        graph_json: &str,
        status: &str,
        now_ms: i64,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO workflow_graphs (workflow_id, version, graph_json, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(workflow_id)
             DO UPDATE SET
               version = excluded.version,
               graph_json = excluded.graph_json,
               status = excluded.status,
               updated_at = excluded.updated_at",
            params![workflow_id, version, graph_json, status, now_ms],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| e.to_string())?;

    for migration in MIGRATIONS {
        if !migration_applied(conn, migration.name)? {
            apply_migration(conn, migration)?;
            conn.execute(
                "INSERT INTO _migrations (name) VALUES (?1)",
                params![migration.name],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn migration_applied(conn: &Connection, name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn apply_migration(conn: &Connection, migration: &Migration) -> Result<(), String> {
    match migration.action {
        MigrationAction::Sql(sql) => conn.execute_batch(sql).map_err(|e| e.to_string()),
        MigrationAction::Seed(seed) => seed(conn),
    }
}

/// 首次迁移时写入「PRD 任务拆分」平台默认提示词（`app_settings`），已存在同名 key 则跳过。
fn seed_platform_split_prompt_default(conn: &Connection) -> Result<(), String> {
    const KEY: &str = "split_prompt_layers:platform_default";
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
            params![KEY],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Ok(());
    }
    let trimmed = PLATFORM_SPLIT_PROMPT_SEED_JSON.trim();
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("内置 PRD 任务拆分模板 JSON 无效: {}", e))?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
        params![KEY, trimmed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_registry_preserves_ordered_names() {
        let names: Vec<&str> = MIGRATIONS.iter().map(|migration| migration.name).collect();
        assert_eq!(
            names,
            vec![
                "001_init",
                "002_mascot_prefs_toast",
                "003_projects_and_settings",
                "004_prd_task_split_results",
                "005_platform_split_prompt_default",
                "006_workflow_store",
                "007_employee_workflow",
                "008_employee_repository_mapping",
                "009_employee_display_order",
                "010_workflow_graph",
                "011_task_event_acceptance_idempotency",
                "012_prd_executable_tasks",
                "013_project_icon_badge",
                "014_project_repository_display_order",
                "015_project_prd_scope",
            ]
        );
    }

    #[test]
    fn run_migrations_applies_all_entries_and_is_idempotent() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite opens");

        run_migrations(&conn).expect("first migration run succeeds");
        run_migrations(&conn).expect("second migration run is idempotent");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .expect("migration rows can be counted");
        assert_eq!(count, MIGRATIONS.len() as i64);

        let stored_names: Vec<String> = conn
            .prepare("SELECT name FROM _migrations ORDER BY name ASC")
            .expect("migration query prepares")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("migration query runs")
            .collect::<Result<Vec<_>, _>>()
            .expect("migration names collect");
        assert_eq!(
            stored_names,
            MIGRATIONS
                .iter()
                .map(|migration| migration.name.to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn run_migrations_seeds_platform_split_prompt_setting() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite opens");

        run_migrations(&conn).expect("migrations succeed");

        let value: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'split_prompt_layers:platform_default'",
                [],
                |row| row.get(0),
            )
            .expect("seed setting exists");
        serde_json::from_str::<serde_json::Value>(&value).expect("seed setting is valid JSON");
    }
}
