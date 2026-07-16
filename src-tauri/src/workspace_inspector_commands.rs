use crate::wise_db::WiseDb;
use crate::workspace_inspector_db::{
    WorkspaceGlobalMemoDto, WorkspaceQuickActionItemDto, WorkspaceQuickActionsPayloadDto,
    WorkspaceTodoItemDto, WorkspaceTodosPayloadDto,
};

#[tauri::command]
pub(crate) fn list_project_workspace_quick_actions(
    db: tauri::State<'_, WiseDb>,
    project_id: String,
) -> Result<WorkspaceQuickActionsPayloadDto, String> {
    db.list_project_workspace_quick_actions(&project_id)
}

#[tauri::command]
pub(crate) fn save_project_workspace_quick_actions(
    db: tauri::State<'_, WiseDb>,
    project_id: String,
    items: Vec<WorkspaceQuickActionItemDto>,
) -> Result<(), String> {
    db.save_project_workspace_quick_actions(&project_id, items)
}

#[tauri::command]
pub(crate) fn list_repository_workspace_quick_actions(
    db: tauri::State<'_, WiseDb>,
    repository_id: i64,
) -> Result<WorkspaceQuickActionsPayloadDto, String> {
    db.list_repository_workspace_quick_actions(repository_id)
}

#[tauri::command]
pub(crate) fn save_repository_workspace_quick_actions(
    db: tauri::State<'_, WiseDb>,
    repository_id: i64,
    items: Vec<WorkspaceQuickActionItemDto>,
) -> Result<(), String> {
    db.save_repository_workspace_quick_actions(repository_id, items)
}

#[tauri::command]
pub(crate) fn list_project_workspace_todos(
    db: tauri::State<'_, WiseDb>,
    project_id: String,
) -> Result<WorkspaceTodosPayloadDto, String> {
    db.list_project_workspace_todos(&project_id)
}

#[tauri::command]
pub(crate) fn save_project_workspace_todos(
    db: tauri::State<'_, WiseDb>,
    project_id: String,
    items: Vec<WorkspaceTodoItemDto>,
) -> Result<(), String> {
    db.save_project_workspace_todos(&project_id, items)
}

#[tauri::command]
pub(crate) fn list_repository_workspace_todos(
    db: tauri::State<'_, WiseDb>,
    repository_id: i64,
) -> Result<WorkspaceTodosPayloadDto, String> {
    db.list_repository_workspace_todos(repository_id)
}

#[tauri::command]
pub(crate) fn save_repository_workspace_todos(
    db: tauri::State<'_, WiseDb>,
    repository_id: i64,
    items: Vec<WorkspaceTodoItemDto>,
) -> Result<(), String> {
    db.save_repository_workspace_todos(repository_id, items)
}

#[tauri::command]
pub(crate) fn list_global_workspace_todos(
    db: tauri::State<'_, WiseDb>,
) -> Result<WorkspaceTodosPayloadDto, String> {
    db.list_global_workspace_todos()
}

#[tauri::command]
pub(crate) fn save_global_workspace_todos(
    db: tauri::State<'_, WiseDb>,
    items: Vec<WorkspaceTodoItemDto>,
) -> Result<(), String> {
    db.save_global_workspace_todos(items)
}

#[tauri::command]
pub(crate) fn get_workspace_global_memo(
    db: tauri::State<'_, WiseDb>,
) -> Result<WorkspaceGlobalMemoDto, String> {
    db.get_workspace_global_memo()
}

#[tauri::command]
pub(crate) fn save_workspace_global_memo(
    db: tauri::State<'_, WiseDb>,
    body_markdown: String,
) -> Result<WorkspaceGlobalMemoDto, String> {
    db.save_workspace_global_memo(body_markdown)
}
