//! Tauri commands for the neutral MCP layer.

use serde::Deserialize;
use tauri::State;

use super::protocol::{McpConnectionTestResult, McpServer, TransportKind};
use super::storage::{self, McpServerInput};
use super::transport;
use crate::wise_db::WiseDb;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdArg {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerArg {
    pub server: McpServerInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestArg {
    /// A persisted server (use `id`) OR a draft (use `draft`). Exactly one
    /// must be set.
    pub id: Option<String>,
    pub draft: Option<McpServerInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineIdArg {
    pub engine_id: String,
}

#[tauri::command]
pub fn mcp_list_servers(db: State<'_, WiseDb>) -> Result<Vec<McpServer>, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    storage::list(&conn)
}

#[tauri::command]
pub fn mcp_save_server(db: State<'_, WiseDb>, arg: ServerArg) -> Result<McpServer, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    storage::upsert(&conn, &arg.server)
}

#[tauri::command]
pub fn mcp_delete_server(db: State<'_, WiseDb>, arg: IdArg) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    storage::delete(&conn, &arg.id)
}

#[tauri::command]
pub async fn mcp_test_connection(
    db: State<'_, WiseDb>,
    arg: TestArg,
) -> Result<McpConnectionTestResult, String> {
    let server = match (arg.id, arg.draft) {
        (Some(id), None) => {
            let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
            storage::get_by_id(&conn, &id)?.ok_or_else(|| format!("no server with id {id}"))?
        }
        (None, Some(draft)) => McpServer {
            id: "draft".to_string(),
            name: draft.name.clone(),
            transport: draft.transport.clone(),
            enabled: draft.enabled,
            source: draft.source.clone(),
            created_at: String::new(),
            updated_at: String::new(),
        },
        _ => return Err("exactly one of `id` or `draft` must be set".to_string()),
    };
    Ok(transport::test_transport(&server).await)
}

#[tauri::command]
pub fn mcp_supported_transports(arg: EngineIdArg) -> Result<Vec<TransportKind>, String> {
    // v1: a static map of known engine ids → supported transports. Plug
    // real `McpProtocol::supported_transports()` callers in once concrete
    // engine implementations land.
    let set: &[TransportKind] = match arg.engine_id.as_str() {
        "claude" => &[TransportKind::Stdio, TransportKind::Sse, TransportKind::Http,
                     TransportKind::StreamableHttp],
        "codex" | "gemini" | "custom" => &[TransportKind::Stdio],
        _ => return Err(format!("unknown engine '{}'", arg.engine_id)),
    };
    Ok(set.to_vec())
}
