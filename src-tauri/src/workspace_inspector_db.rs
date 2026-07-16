//! 右栏 Inspector：快捷操作、待办事项与全局备忘录的 SQLite 持久化。

use crate::wise_db::WiseDb;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const QUICK_ACTIONS_PROJECT_PREFIX: &str = "wise.workspaceQuickActions.project:";
const QUICK_ACTIONS_REPOSITORY_PREFIX: &str = "wise.workspaceQuickActions.repository:";
const KEY_SUFFIX: &str = ".v1";

/// 全局待办事项的固定 scope_id（scope_kind = 'global'，不绑定工作区/仓库）。
pub const GLOBAL_TODO_SCOPE_ID: &str = "_global_";

/// 全局备忘录单行主键。
const GLOBAL_MEMO_ID: &str = "default";
/// 备忘录 Markdown 体积上限（约 512 KiB），防止异常写入撑爆库。
const GLOBAL_MEMO_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceQuickActionItemDto {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub target: String,
    #[serde(default)]
    pub pinned_to_topbar: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceQuickActionsPayloadDto {
    pub version: i32,
    pub items: Vec<WorkspaceQuickActionItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTodoItemDto {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTodosPayloadDto {
    pub version: i32,
    pub items: Vec<WorkspaceTodoItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGlobalMemoDto {
    pub body_markdown: String,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
struct LegacyQuickActionsPayload {
    #[serde(default)]
    items: Vec<WorkspaceQuickActionItemDto>,
}

fn normalize_quick_action_kind(raw: &str) -> Option<String> {
    match raw.trim() {
        "link" | "directory" => Some(raw.trim().to_string()),
        _ => None,
    }
}

fn normalize_quick_action_item(raw: WorkspaceQuickActionItemDto) -> Option<WorkspaceQuickActionItemDto> {
    let id = raw.id.trim();
    let kind = normalize_quick_action_kind(&raw.kind)?;
    let label = raw.label.trim();
    let target = raw.target.trim();
    if id.is_empty() || label.is_empty() || target.is_empty() {
        return None;
    }
    let created_at = if raw.created_at > 0 {
        raw.created_at
    } else {
        crate::wise_db::unix_now_ms()
    };
    let updated_at = if raw.updated_at > 0 {
        raw.updated_at
    } else {
        created_at
    };
    Some(WorkspaceQuickActionItemDto {
        id: id.to_string(),
        kind,
        label: label.to_string(),
        target: target.to_string(),
        pinned_to_topbar: raw.pinned_to_topbar,
        created_at,
        updated_at,
    })
}

fn dedupe_quick_actions(items: Vec<WorkspaceQuickActionItemDto>) -> Vec<WorkspaceQuickActionItemDto> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if !seen.insert(item.id.clone()) {
            continue;
        }
        out.push(item);
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

fn normalize_todo_item(raw: WorkspaceTodoItemDto) -> Option<WorkspaceTodoItemDto> {
    let id = raw.id.trim();
    if id.is_empty() {
        return None;
    }
    let title = raw.title.trim();
    let title = if title.is_empty() {
        "无标题".to_string()
    } else {
        title.to_string()
    };
    let created_at = if raw.created_at > 0 {
        raw.created_at
    } else {
        crate::wise_db::unix_now_ms()
    };
    let updated_at = if raw.updated_at > 0 {
        raw.updated_at
    } else {
        created_at
    };
    let due_at = raw.due_at.filter(|v| *v > 0);
    let sort_order = if raw.sort_order > 0 {
        raw.sort_order
    } else {
        created_at
    };
    Some(WorkspaceTodoItemDto {
        id: id.to_string(),
        title,
        completed: raw.completed,
        due_at,
        notes: raw.notes,
        sort_order,
        created_at,
        updated_at,
    })
}

fn dedupe_todos(items: Vec<WorkspaceTodoItemDto>) -> Vec<WorkspaceTodoItemDto> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if !seen.insert(item.id.clone()) {
            continue;
        }
        out.push(item);
    }
    out.sort_by(|a, b| {
        a.completed
            .cmp(&b.completed)
            .then(a.sort_order.cmp(&b.sort_order))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    out
}

fn scope_has_quick_actions(conn: &Connection, scope_kind: &str, scope_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_quick_actions WHERE scope_kind = ?1 AND scope_id = ?2",
            params![scope_kind, scope_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn replace_quick_actions_conn(
    conn: &Connection,
    scope_kind: &str,
    scope_id: &str,
    items: &[WorkspaceQuickActionItemDto],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_quick_actions WHERE scope_kind = ?1 AND scope_id = ?2",
        params![scope_kind, scope_id],
    )
    .map_err(|e| e.to_string())?;
    for item in items {
        conn.execute(
            "INSERT INTO workspace_quick_actions (
                scope_kind, scope_id, id, kind, label, target, pinned_to_topbar, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                scope_kind,
                scope_id,
                item.id,
                item.kind,
                item.label,
                item.target,
                if item.pinned_to_topbar { 1 } else { 0 },
                item.created_at,
                item.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn list_quick_actions_conn(
    conn: &Connection,
    scope_kind: &str,
    scope_id: &str,
) -> Result<Vec<WorkspaceQuickActionItemDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, label, target, pinned_to_topbar, created_at, updated_at
             FROM workspace_quick_actions
             WHERE scope_kind = ?1 AND scope_id = ?2
             ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![scope_kind, scope_id], |row| {
            let pinned: i64 = row.get(4)?;
            Ok(WorkspaceQuickActionItemDto {
                id: row.get(0)?,
                kind: row.get(1)?,
                label: row.get(2)?,
                target: row.get(3)?,
                pinned_to_topbar: pinned != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        if let Some(item) = normalize_quick_action_item(row.map_err(|e| e.to_string())?) {
            items.push(item);
        }
    }
    Ok(dedupe_quick_actions(items))
}

fn replace_todos_conn(
    conn: &Connection,
    scope_kind: &str,
    scope_id: &str,
    items: &[WorkspaceTodoItemDto],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_todos WHERE scope_kind = ?1 AND scope_id = ?2",
        params![scope_kind, scope_id],
    )
    .map_err(|e| e.to_string())?;
    for item in items {
        conn.execute(
            "INSERT INTO workspace_todos (
                scope_kind, scope_id, id, title, completed, due_at, notes, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                scope_kind,
                scope_id,
                item.id,
                item.title,
                if item.completed { 1 } else { 0 },
                item.due_at,
                item.notes,
                item.sort_order,
                item.created_at,
                item.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn get_workspace_global_memo_conn(conn: &Connection) -> Result<WorkspaceGlobalMemoDto, String> {
    let row = conn
        .query_row(
            "SELECT body_markdown, updated_at FROM workspace_global_memo WHERE id = ?1",
            params![GLOBAL_MEMO_ID],
            |row| {
                Ok(WorkspaceGlobalMemoDto {
                    body_markdown: row.get(0)?,
                    updated_at: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row.unwrap_or(WorkspaceGlobalMemoDto {
        body_markdown: String::new(),
        updated_at: 0,
    }))
}

fn list_todos_conn(
    conn: &Connection,
    scope_kind: &str,
    scope_id: &str,
) -> Result<WorkspaceTodosPayloadDto, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, completed, due_at, notes, sort_order, created_at, updated_at
             FROM workspace_todos
             WHERE scope_kind = ?1 AND scope_id = ?2
             ORDER BY completed ASC, sort_order ASC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![scope_kind, scope_id], |row| {
            let completed_int: i64 = row.get(2)?;
            Ok(WorkspaceTodoItemDto {
                id: row.get(0)?,
                title: row.get(1)?,
                completed: completed_int != 0,
                due_at: row.get(3)?,
                notes: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        if let Some(item) = normalize_todo_item(row.map_err(|e| e.to_string())?) {
            items.push(item);
        }
    }
    Ok(WorkspaceTodosPayloadDto {
        version: 1,
        items: dedupe_todos(items),
    })
}

fn parse_legacy_scope_key(
    key: &str,
    project_prefix: &str,
    repository_prefix: &str,
) -> Option<(&'static str, String)> {
    if let Some(rest) = key.strip_prefix(project_prefix) {
        let id = rest.strip_suffix(KEY_SUFFIX)?.trim();
        if id.is_empty() {
            return None;
        }
        return Some(("project", id.to_string()));
    }
    if let Some(rest) = key.strip_prefix(repository_prefix) {
        let id = rest.strip_suffix(KEY_SUFFIX)?.trim();
        if id.is_empty() {
            return None;
        }
        return Some(("repository", id.to_string()));
    }
    None
}

fn import_legacy_quick_actions(
    conn: &Connection,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let Some((scope_kind, scope_id)) =
        parse_legacy_scope_key(key, QUICK_ACTIONS_PROJECT_PREFIX, QUICK_ACTIONS_REPOSITORY_PREFIX)
    else {
        return Ok(());
    };
    if scope_has_quick_actions(conn, scope_kind, &scope_id)? {
        return Ok(());
    }
    let parsed: LegacyQuickActionsPayload =
        serde_json::from_str(value).map_err(|e| format!("快捷操作 JSON 无效: {}", e))?;
    let items: Vec<WorkspaceQuickActionItemDto> = parsed
        .items
        .into_iter()
        .filter_map(normalize_quick_action_item)
        .collect();
    if items.is_empty() {
        return Ok(());
    }
    replace_quick_actions_conn(conn, scope_kind, &scope_id, &dedupe_quick_actions(items))
}

pub fn seed_migrate_workspace_inspector_from_app_settings(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM app_settings
             WHERE key LIKE 'wise.workspaceQuickActions.%'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut keys_to_delete = Vec::new();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        if key.starts_with(QUICK_ACTIONS_PROJECT_PREFIX)
            || key.starts_with(QUICK_ACTIONS_REPOSITORY_PREFIX)
        {
            import_legacy_quick_actions(conn, &key, &value)?;
        }
        keys_to_delete.push(key);
    }
    for key in keys_to_delete {
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 把现有 project/repository 待办合并迁移到 global 作用域（幂等）。
///
/// 仅当 global 作用域尚无数据时执行；旧 project/repository 行保留不动
/// （UI 已切换为全局读写，旧数据仅作留档，符合「不删数据」规则）。
/// 跨作用域 id 冲突时保留最新 updatedAt（createWorkspaceTodoId 为 UUID，冲突概率极低）。
pub fn seed_migrate_workspace_todos_to_global(conn: &Connection) -> Result<(), String> {
    let global_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_todos WHERE scope_kind = 'global' AND scope_id = ?1",
            params![GLOBAL_TODO_SCOPE_ID],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if global_count > 0 {
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, title, completed, due_at, notes, sort_order, created_at, updated_at
             FROM workspace_todos
             WHERE scope_kind IN ('project', 'repository')
             ORDER BY updated_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let completed_int: i64 = row.get(2)?;
            Ok(WorkspaceTodoItemDto {
                id: row.get(0)?,
                title: row.get(1)?,
                completed: completed_int != 0,
                due_at: row.get(3)?,
                notes: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut by_id: std::collections::HashMap<String, WorkspaceTodoItemDto> =
        std::collections::HashMap::new();
    for row in rows {
        let item = match row {
            Ok(dto) => dto,
            Err(e) => return Err(e.to_string()),
        };
        if let Some(normalized) = normalize_todo_item(item) {
            match by_id.get(&normalized.id) {
                Some(existing) if existing.updated_at >= normalized.updated_at => continue,
                _ => {
                    by_id.insert(normalized.id.clone(), normalized);
                }
            }
        }
    }

    if by_id.is_empty() {
        return Ok(());
    }

    let merged: Vec<WorkspaceTodoItemDto> = by_id.into_values().collect();
    replace_todos_conn(conn, "global", GLOBAL_TODO_SCOPE_ID, &dedupe_todos(merged))?;
    Ok(())
}

/// 修复旧库未成功执行 035 迁移时缺少 `pinned_to_topbar` 列的问题。
pub fn ensure_workspace_quick_actions_pinned_column(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(workspace_quick_actions)")
        .map_err(|e| e.to_string())?;
    let mut has_column = false;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in rows {
        if name.map_err(|e| e.to_string())? == "pinned_to_topbar" {
            has_column = true;
            break;
        }
    }
    if has_column {
        return Ok(());
    }
    conn.execute_batch(
        "ALTER TABLE workspace_quick_actions
           ADD COLUMN pinned_to_topbar INTEGER NOT NULL DEFAULT 0
           CHECK (pinned_to_topbar IN (0, 1));",
    )
    .map_err(|e| e.to_string())
}

impl WiseDb {
    pub fn list_project_workspace_quick_actions(
        &self,
        project_id: &str,
    ) -> Result<WorkspaceQuickActionsPayloadDto, String> {
        let id = project_id.trim();
        if id.is_empty() {
            return Ok(WorkspaceQuickActionsPayloadDto {
                version: 1,
                items: vec![],
            });
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let items = list_quick_actions_conn(&g, "project", id)?;
        Ok(WorkspaceQuickActionsPayloadDto {
            version: 1,
            items,
        })
    }

    pub fn save_project_workspace_quick_actions(
        &self,
        project_id: &str,
        items: Vec<WorkspaceQuickActionItemDto>,
    ) -> Result<(), String> {
        let id = project_id.trim();
        if id.is_empty() {
            return Ok(());
        }
        let normalized: Vec<WorkspaceQuickActionItemDto> = items
            .into_iter()
            .filter_map(normalize_quick_action_item)
            .collect();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        replace_quick_actions_conn(&g, "project", id, &dedupe_quick_actions(normalized))
    }

    pub fn list_repository_workspace_quick_actions(
        &self,
        repository_id: i64,
    ) -> Result<WorkspaceQuickActionsPayloadDto, String> {
        if repository_id <= 0 {
            return Ok(WorkspaceQuickActionsPayloadDto {
                version: 1,
                items: vec![],
            });
        }
        let scope_id = repository_id.to_string();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let items = list_quick_actions_conn(&g, "repository", &scope_id)?;
        Ok(WorkspaceQuickActionsPayloadDto {
            version: 1,
            items,
        })
    }

    pub fn save_repository_workspace_quick_actions(
        &self,
        repository_id: i64,
        items: Vec<WorkspaceQuickActionItemDto>,
    ) -> Result<(), String> {
        if repository_id <= 0 {
            return Ok(());
        }
        let scope_id = repository_id.to_string();
        let normalized: Vec<WorkspaceQuickActionItemDto> = items
            .into_iter()
            .filter_map(normalize_quick_action_item)
            .collect();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        replace_quick_actions_conn(&g, "repository", &scope_id, &dedupe_quick_actions(normalized))
    }

    pub fn list_project_workspace_todos(
        &self,
        project_id: &str,
    ) -> Result<WorkspaceTodosPayloadDto, String> {
        let id = project_id.trim();
        if id.is_empty() {
            return Ok(WorkspaceTodosPayloadDto {
                version: 1,
                items: vec![],
            });
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_todos_conn(&g, "project", id)
    }

    pub fn save_project_workspace_todos(
        &self,
        project_id: &str,
        items: Vec<WorkspaceTodoItemDto>,
    ) -> Result<(), String> {
        let id = project_id.trim();
        if id.is_empty() {
            return Ok(());
        }
        let normalized: Vec<WorkspaceTodoItemDto> = items
            .into_iter()
            .filter_map(normalize_todo_item)
            .collect();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        replace_todos_conn(&g, "project", id, &dedupe_todos(normalized))
    }

    pub fn list_repository_workspace_todos(
        &self,
        repository_id: i64,
    ) -> Result<WorkspaceTodosPayloadDto, String> {
        if repository_id <= 0 {
            return Ok(WorkspaceTodosPayloadDto {
                version: 1,
                items: vec![],
            });
        }
        let scope_id = repository_id.to_string();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_todos_conn(&g, "repository", &scope_id)
    }

    pub fn save_repository_workspace_todos(
        &self,
        repository_id: i64,
        items: Vec<WorkspaceTodoItemDto>,
    ) -> Result<(), String> {
        if repository_id <= 0 {
            return Ok(());
        }
        let scope_id = repository_id.to_string();
        let normalized: Vec<WorkspaceTodoItemDto> = items
            .into_iter()
            .filter_map(normalize_todo_item)
            .collect();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        replace_todos_conn(&g, "repository", &scope_id, &dedupe_todos(normalized))
    }

    pub fn list_global_workspace_todos(&self) -> Result<WorkspaceTodosPayloadDto, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_todos_conn(&g, "global", GLOBAL_TODO_SCOPE_ID)
    }

    pub fn save_global_workspace_todos(
        &self,
        items: Vec<WorkspaceTodoItemDto>,
    ) -> Result<(), String> {
        let normalized: Vec<WorkspaceTodoItemDto> = items
            .into_iter()
            .filter_map(normalize_todo_item)
            .collect();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        replace_todos_conn(&g, "global", GLOBAL_TODO_SCOPE_ID, &dedupe_todos(normalized))
    }

    pub fn get_workspace_global_memo(&self) -> Result<WorkspaceGlobalMemoDto, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        get_workspace_global_memo_conn(&g)
    }

    pub fn save_workspace_global_memo(
        &self,
        body_markdown: String,
    ) -> Result<WorkspaceGlobalMemoDto, String> {
        if body_markdown.len() > GLOBAL_MEMO_MAX_BYTES {
            return Err(format!(
                "备忘录内容过长（最多 {} 字节）",
                GLOBAL_MEMO_MAX_BYTES
            ));
        }
        let updated_at = crate::wise_db::unix_now_ms();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO workspace_global_memo (id, body_markdown, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               body_markdown = excluded.body_markdown,
               updated_at = excluded.updated_at",
            params![GLOBAL_MEMO_ID, body_markdown, updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(WorkspaceGlobalMemoDto {
            body_markdown,
            updated_at,
        })
    }

    #[allow(dead_code)]
    pub fn delete_project_workspace_inspector_data(&self, project_id: &str) -> Result<(), String> {
        let id = project_id.trim();
        if id.is_empty() {
            return Ok(());
        }
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        for sql in [
            "DELETE FROM workspace_quick_actions WHERE scope_kind = 'project' AND scope_id = ?1",
            "DELETE FROM workspace_todos WHERE scope_kind = 'project' AND scope_id = ?1",
        ] {
            g.execute(sql, params![id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_repository_workspace_inspector_data(
        &self,
        repository_id: i64,
    ) -> Result<(), String> {
        if repository_id <= 0 {
            return Ok(());
        }
        let scope_id = repository_id.to_string();
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        for sql in [
            "DELETE FROM workspace_quick_actions WHERE scope_kind = 'repository' AND scope_id = ?1",
            "DELETE FROM workspace_todos WHERE scope_kind = 'repository' AND scope_id = ?1",
        ] {
            g.execute(sql, params![scope_id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_with_migrations() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(include_str!("../migrations/031_workspace_inspector.sql"))
            .expect("schema applies");
        conn.execute_batch(include_str!("../migrations/033_workspace_todos.sql"))
            .expect("todos schema applies");
        conn.execute_batch(include_str!("../migrations/035_workspace_quick_actions_pinned.sql"))
            .expect("pinned schema applies");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_settings (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL
             );",
        )
        .expect("app_settings stub");
        conn.execute_batch(include_str!("../migrations/042_drop_workspace_memos.sql"))
            .expect("drop memos schema applies");
        conn.execute_batch(include_str!("../migrations/049_workspace_global_memo.sql"))
            .expect("global memo schema applies");
        conn
    }

    #[test]
    fn global_memo_round_trip() {
        let conn = open_with_migrations();
        let empty = get_workspace_global_memo_conn(&conn).expect("load empty");
        assert_eq!(empty.body_markdown, "");
        assert_eq!(empty.updated_at, 0);

        let updated_at = 1_700_000_000_000i64;
        conn.execute(
            "INSERT INTO workspace_global_memo (id, body_markdown, updated_at) VALUES (?1, ?2, ?3)",
            params![GLOBAL_MEMO_ID, "# hello\n\nworld", updated_at],
        )
        .expect("insert");
        let loaded = get_workspace_global_memo_conn(&conn).expect("load");
        assert_eq!(loaded.body_markdown, "# hello\n\nworld");
        assert_eq!(loaded.updated_at, updated_at);
    }

    #[test]
    fn todos_round_trip() {
        let conn = open_with_migrations();
        let item = WorkspaceTodoItemDto {
            id: "t1".to_string(),
            title: "Buy milk".to_string(),
            completed: false,
            due_at: None,
            notes: String::new(),
            sort_order: 1,
            created_at: 10,
            updated_at: 20,
        };
        replace_todos_conn(&conn, "project", "p1", &[item.clone()]).expect("save");
        let loaded = list_todos_conn(&conn, "project", "p1").expect("load");
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(loaded.items[0].title, "Buy milk");
    }

    #[test]
    fn quick_actions_round_trip() {
        let conn = open_with_migrations();
        let item = WorkspaceQuickActionItemDto {
            id: "a1".to_string(),
            kind: "link".to_string(),
            label: "Docs".to_string(),
            target: "https://example.com".to_string(),
            pinned_to_topbar: false,
            created_at: 1,
            updated_at: 2,
        };
        replace_quick_actions_conn(&conn, "project", "p1", &[item.clone()]).expect("save");
        let loaded = list_quick_actions_conn(&conn, "project", "p1").expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].label, "Docs");
    }

    #[test]
    fn legacy_quick_actions_import() {
        let conn = open_with_migrations();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
        )
        .expect("app_settings table");
        let key = "wise.workspaceQuickActions.project:eco.v1";
        let value = r#"{"version":1,"items":[{"id":"x","kind":"link","label":"T","target":"https://t.com","createdAt":1,"updatedAt":2}]}"#;
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .expect("seed legacy");
        seed_migrate_workspace_inspector_from_app_settings(&conn).expect("migrate");
        let loaded = list_quick_actions_conn(&conn, "project", "eco").expect("load");
        assert_eq!(loaded.len(), 1);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(n, 0);
    }
}
