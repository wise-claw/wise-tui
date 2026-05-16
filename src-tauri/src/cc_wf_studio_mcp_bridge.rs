//! CC Workflow Studio ↔ Claude Code：Wise Webview 桥（/invoke）+ 上游对齐的 HTTP MCP 子进程（/mcp）。

use std::collections::HashMap;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use uuid::Uuid;

const MCP_SERVER_NAME: &str = "cc-workflow-studio";
const DEFAULT_MCP_PORT: u16 = 6282;

struct BridgeInner {
    bridge_port: u16,
    bridge_token: String,
    mcp_port: u16,
    project_path: String,
    review_before_apply: Mutex<bool>,
    mcp_child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

static BRIDGE: OnceLock<Mutex<Option<Arc<BridgeInner>>>> = OnceLock::new();

fn bridge_cell() -> &'static Mutex<Option<Arc<BridgeInner>>> {
    BRIDGE.get_or_init(|| Mutex::new(None))
}

#[derive(serde::Deserialize)]
struct InvokeBody {
    op: String,
    #[serde(default)]
    payload: Value,
}

fn is_tcp_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid localhost addr"),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn wait_for_tcp_port(port: u16, max_wait_ms: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(max_wait_ms);
    while std::time::Instant::now() < deadline {
        if is_tcp_port_open(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(format!("端口 {port} 在 {max_wait_ms}ms 内未就绪"))
}

/// 清理占用 MCP 端口的陈旧子进程（Wise 重启后 bun 可能仍持有过期的 bridge 环境变量）。
pub(crate) fn kill_stale_cc_wf_studio_mcp_listeners(port: u16) {
    let Ok(out) = Command::new("lsof")
        .args(["-n", "-P", "-sTCP:LISTEN", "-ti", &format!(":{port}")])
        .output()
    else {
        return;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let pid = line.trim();
        if pid.is_empty() {
            continue;
        }
        let _ = Command::new("kill").arg(pid).status();
    }
}

fn bridge_is_healthy(inner: &BridgeInner) -> bool {
    is_mcp_child_running(inner)
        && is_tcp_port_open(inner.bridge_port)
        && is_tcp_port_open(inner.mcp_port)
}

fn find_headers_body_split(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn header_value<'a>(headers: &'a str, key: &str) -> Option<&'a str> {
    let lk = key.to_ascii_lowercase();
    for line in headers.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        if k.trim().to_ascii_lowercase() == lk {
            return Some(v.trim());
        }
    }
    None
}

fn parse_content_length(headers: &str) -> Option<usize> {
    header_value(headers, "content-length")?.parse().ok()
}

fn extract_bearer(headers: &str) -> Option<String> {
    let a = header_value(headers, "authorization")?;
    let rest = a.strip_prefix("Bearer")?.trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

fn http_json_response(body: &[u8]) -> Vec<u8> {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body.iter().copied())
    .collect()
}

fn list_agents_for_repo(repo: &str, include_content: bool) -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法解析主目录".to_string())?;
    let mut commands: Vec<Value> = Vec::new();

    fn push_dir(dir: &Path, scope: &str, include_content: bool, out: &mut Vec<Value>) {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) != Some("md") {
                    continue;
                }
                let name = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("agent")
                    .to_string();
                let mut item = json!({
                    "name": name,
                    "scope": scope,
                    "commandPath": p.to_string_lossy(),
                });
                if include_content {
                    if let Ok(content) = std::fs::read_to_string(&p) {
                        if let Some(o) = item.as_object_mut() {
                            o.insert("promptContent".into(), json!(content));
                        }
                    }
                }
                out.push(item);
            }
        }
    }

    push_dir(
        &home.join(".claude/agents"),
        "user",
        include_content,
        &mut commands,
    );
    let rp = repo.trim();
    if !rp.is_empty() {
        push_dir(
            &PathBuf::from(rp).join(".claude/agents"),
            "project",
            include_content,
            &mut commands,
        );
    }

    let user_count = commands
        .iter()
        .filter(|c| c.get("scope") == Some(&json!("user")))
        .count();
    let project_count = commands.len() - user_count;

    Ok(json!({
        "success": true,
        "commands": commands,
        "totalCount": commands.len(),
        "userCount": user_count,
        "projectCount": project_count,
    }))
}

async fn handle_bridge_connection(
    mut socket: tokio::net::TcpStream,
    inner: Arc<BridgeInner>,
    app: AppHandle,
) {
    let mut buf = vec![0u8; 256 * 1024];
    let n = match socket.read(&mut buf).await {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };
    let Some(split) = find_headers_body_split(&buf[..n]) else {
        return;
    };
    let headers = String::from_utf8_lossy(&buf[..split]);
    let bearer = extract_bearer(&headers).unwrap_or_default();
    if bearer != inner.bridge_token {
        let body = br#"{"ok":false,"error":"unauthorized"}"#;
        let _ = socket.write_all(&http_json_response(body)).await;
        return;
    }
    let cl = parse_content_length(&headers).unwrap_or(0);
    let body_start = split + 4;
    let mut all = buf[..n].to_vec();
    while all.len() < body_start + cl {
        let m = match socket.read(&mut buf).await {
            Ok(0) => break,
            Ok(m) => m,
            Err(_) => break,
        };
        if m == 0 {
            break;
        }
        all.extend_from_slice(&buf[..m]);
    }
    if all.len() < body_start + cl {
        let body = br#"{"ok":false,"error":"incomplete body"}"#;
        let _ = socket.write_all(&http_json_response(body)).await;
        return;
    }
    let body_bytes = &all[body_start..body_start + cl];
    let wire: InvokeBody = match serde_json::from_slice(body_bytes) {
        Ok(w) => w,
        Err(e) => {
            let msg = format!("invalid json: {e}");
            let body = serde_json::to_vec(&json!({ "ok": false, "error": msg }))
                .unwrap_or_else(|_| b"{}".to_vec());
            let _ = socket.write_all(&http_json_response(&body)).await;
            return;
        }
    };

    let review = *inner
        .review_before_apply
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let result: Result<Value, String> = match wire.op.as_str() {
        "list_available_agents" => {
            let repo = wire
                .payload
                .get("repositoryPath")
                .and_then(|x| x.as_str())
                .unwrap_or(inner.project_path.as_str());
            let include = wire
                .payload
                .get("includeContent")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            list_agents_for_repo(repo, include)
        }
        "highlight_group_node" => {
            let gid = wire
                .payload
                .get("groupNodeId")
                .cloned()
                .unwrap_or(Value::Null);
            let _ = app.emit(
                "cc-wf-studio-mcp-invoke",
                json!({
                    "kind": "highlight_group_node",
                    "payload": { "groupNodeId": gid },
                }),
            );
            Ok(json!({ "success": true }))
        }
        "get_current_workflow" => {
            let cid = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            {
                let mut p = inner.pending.lock().unwrap_or_else(|e| e.into_inner());
                p.insert(cid.clone(), tx);
            }
            let _ = app.emit(
                "cc-wf-studio-mcp-invoke",
                json!({
                    "kind": "get_current_workflow",
                    "correlationId": cid,
                }),
            );
            match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
                Ok(Ok(Ok(v))) => {
                    let workflow = v.get("workflow").cloned();
                    let revision = v.get("revision").and_then(|x| x.as_i64()).unwrap_or(-1);
                    Ok(json!({
                        "workflow": workflow,
                        "revision": revision,
                        "isStale": false,
                    }))
                }
                Ok(Ok(Err(e))) => Err(e),
                Ok(Err(_)) => Err("internal channel closed".into()),
                Err(_) => {
                    let mut p = inner.pending.lock().unwrap_or_else(|e| e.into_inner());
                    p.remove(&cid);
                    Err("timeout waiting for workflow from webview".into())
                }
            }
        }
        "apply_workflow_from_mcp" => {
            let cid = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            {
                let mut p = inner.pending.lock().unwrap_or_else(|e| e.into_inner());
                p.insert(cid.clone(), tx);
            }
            let mut payload = wire.payload;
            if let Some(o) = payload.as_object_mut() {
                o.insert("correlationId".into(), json!(cid));
                if !o.contains_key("requireConfirmation") {
                    o.insert("requireConfirmation".into(), json!(review));
                }
            } else {
                payload = json!({
                    "correlationId": cid,
                    "requireConfirmation": review,
                });
            }
            let timeout_secs = if review { 300 } else { 120 };
            let _ = app.emit(
                "cc-wf-studio-mcp-invoke",
                json!({
                    "kind": "apply_workflow_from_mcp",
                    "payload": payload,
                }),
            );
            match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
                Ok(Ok(Ok(v))) => Ok(v),
                Ok(Ok(Err(e))) => Err(e),
                Ok(Err(_)) => Err("internal channel closed".into()),
                Err(_) => {
                    let mut p = inner.pending.lock().unwrap_or_else(|e| e.into_inner());
                    p.remove(&cid);
                    Err("timeout waiting for apply from webview".into())
                }
            }
        }
        other => Err(format!("unknown op: {other}")),
    };

    let out = match result {
        Ok(v) => json!({ "ok": true, "data": v }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    let body = serde_json::to_vec(&out).unwrap_or_else(|_| b"{}".to_vec());
    let _ = socket.write_all(&http_json_response(&body)).await;
}

fn resolve_mcp_http_script(app: &AppHandle) -> Result<PathBuf, String> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/cc-workflow-studio-mcp/http-server.mjs");
    if dev.is_file() {
        return dev.canonicalize().map_err(|e| e.to_string());
    }
    let res = app
        .path()
        .resolve(
            "cc-workflow-studio-mcp/http-server.mjs",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| e.to_string())?;
    if res.is_file() {
        return Ok(res);
    }
    Err(format!(
        "未找到 MCP HTTP 脚本（开发路径 {} 或资源路径）",
        dev.display()
    ))
}

fn resolve_schema_toon_path(app: &AppHandle) -> Option<String> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/cc-workflow-studio-mcp/resources/workflow-schema.toon");
    if dev.is_file() {
        return dev
            .canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().to_string());
    }
    let res = app
        .path()
        .resolve(
            "cc-workflow-studio-mcp/resources/workflow-schema.toon",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()?;
    if res.is_file() {
        Some(res.to_string_lossy().to_string())
    } else {
        None
    }
}

fn write_claude_project_mcp_json(project_path: &str, mcp_port: u16) -> Result<(), String> {
    let path = PathBuf::from(project_path.trim()).join(".mcp.json");
    let url = format!("http://127.0.0.1:{mcp_port}/mcp");
    let mut config: Value = if path.is_file() {
        let raw =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 .mcp.json 失败: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    let obj = config
        .as_object_mut()
        .ok_or_else(|| ".mcp.json 根须为对象".to_string())?;
    let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));
    let servers_obj = servers
        .as_object_mut()
        .ok_or_else(|| "mcpServers 须为对象".to_string())?;
    servers_obj.insert(
        MCP_SERVER_NAME.to_string(),
        json!({
            "type": "http",
            "url": url,
        }),
    );
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let out = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{out}\n")).map_err(|e| format!("写入 .mcp.json 失败: {e}"))?;
    Ok(())
}

fn spawn_mcp_http_process(
    app: &AppHandle,
    bridge_port: u16,
    bridge_token: &str,
    project_path: &str,
    mcp_port: u16,
    review_before_apply: bool,
) -> Result<Child, String> {
    let script = resolve_mcp_http_script(app)?;
    let schema = resolve_schema_toon_path(app);
    let mut cmd = Command::new("bun");
    cmd.arg(&script)
        .env(
            "WISE_CC_WF_BRIDGE_BASE",
            format!("http://127.0.0.1:{bridge_port}"),
        )
        .env("WISE_CC_WF_BRIDGE_TOKEN", bridge_token)
        .env("WISE_CC_WF_REPO", project_path)
        .env("WISE_CC_WF_MCP_PORT", mcp_port.to_string())
        .env(
            "WISE_CC_WF_REVIEW_BEFORE_APPLY",
            if review_before_apply { "true" } else { "false" },
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(s) = schema {
        cmd.env("CC_WF_STUDIO_SCHEMA_TOON", s);
    }
    cmd.spawn()
        .map_err(|e| format!("启动 MCP HTTP 子进程失败: {e}"))
}

fn stop_mcp_child(inner: &BridgeInner) {
    let mut guard = inner.mcp_child.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn is_mcp_child_running(inner: &BridgeInner) -> bool {
    let mut guard = inner.mcp_child.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcWfStudioMcpBridgeStatus {
    pub running: bool,
    pub port: Option<u32>,
}

#[tauri::command]
pub fn cc_wf_studio_mcp_bridge_status() -> Result<CcWfStudioMcpBridgeStatus, String> {
    let g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
    Ok(match g.as_ref() {
        Some(b) if bridge_is_healthy(b) => CcWfStudioMcpBridgeStatus {
            running: true,
            port: Some(b.mcp_port as u32),
        },
        Some(_) => CcWfStudioMcpBridgeStatus {
            running: false,
            port: None,
        },
        None => CcWfStudioMcpBridgeStatus {
            running: false,
            port: None,
        },
    })
}

#[tauri::command]
pub fn cc_wf_studio_mcp_set_review_before_apply(value: bool) -> Result<(), String> {
    let g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
    let inner = g.as_ref().ok_or_else(|| "MCP 桥未启动".to_string())?;
    *inner
        .review_before_apply
        .lock()
        .map_err(|_| "lock poisoned")? = value;
    Ok(())
}

#[tauri::command]
pub fn cc_wf_studio_mcp_bridge_resolve(
    correlation_id: String,
    ok: bool,
    body: Option<Value>,
    err: Option<String>,
) -> Result<(), String> {
    let g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
    let inner = g.as_ref().ok_or_else(|| "MCP 桥未启动".to_string())?;
    let mut pend = inner
        .pending
        .lock()
        .map_err(|_| "pending lock poisoned".to_string())?;
    let tx = pend
        .remove(&correlation_id)
        .ok_or_else(|| format!("未知的 correlationId: {correlation_id}"))?;
    drop(pend);
    let send_result = if ok {
        tx.send(Ok(body.unwrap_or(Value::Null)))
    } else {
        tx.send(Err(err.unwrap_or_else(|| "error".into())))
    };
    if send_result.is_err() {
        return Err("MCP 调用方已断开".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn start_cc_wf_studio_mcp_bridge(
    app: AppHandle,
    project_path: String,
) -> Result<CcWfStudioMcpBridgeStatus, String> {
    let project = project_path.trim().to_string();
    if project.is_empty() {
        return Err("projectPath 不能为空".into());
    }

    {
        let g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
        if let Some(b) = g.as_ref() {
            if b.project_path == project && bridge_is_healthy(b) {
                return Ok(CcWfStudioMcpBridgeStatus {
                    running: true,
                    port: Some(b.mcp_port as u32),
                });
            }
        }
    }

    // 切换仓库、桥不健康、或 MCP 子进程持有过期 bridge 环境变量时，完整重启。
    kill_stale_cc_wf_studio_mcp_listeners(DEFAULT_MCP_PORT);

    // 切换仓库时停止旧实例
    {
        let mut g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
        if let Some(old) = g.take() {
            stop_mcp_child(&old);
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("绑定 Webview 桥端口失败: {e}"))?;
    let bridge_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let bridge_token = Uuid::new_v4().to_string();
    let mcp_port = DEFAULT_MCP_PORT;
    let review_before_apply = true;

    let inner = Arc::new(BridgeInner {
        bridge_port,
        bridge_token: bridge_token.clone(),
        mcp_port,
        project_path: project.clone(),
        review_before_apply: Mutex::new(review_before_apply),
        mcp_child: Mutex::new(None),
        pending: Mutex::new(HashMap::new()),
    });

    {
        let mut g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
        *g = Some(inner.clone());
    }

    let app2 = app.clone();
    let inner_loop = inner.clone();
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, _)) => {
                    let inner3 = inner_loop.clone();
                    let app3 = app2.clone();
                    tokio::spawn(async move {
                        handle_bridge_connection(socket, inner3, app3).await;
                    });
                }
                Err(_) => break,
            }
        }
    });

    {
        let mut child = spawn_mcp_http_process(
            &app,
            bridge_port,
            &bridge_token,
            &project,
            mcp_port,
            review_before_apply,
        )?;
        std::thread::sleep(Duration::from_millis(150));
        if !matches!(child.try_wait(), Ok(None)) {
            kill_stale_cc_wf_studio_mcp_listeners(mcp_port);
            let mut g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
            *g = None;
            return Err("MCP HTTP 子进程启动后立即退出（6282 端口可能被占用）。请重试。".into());
        }
        let mut guard = inner
            .mcp_child
            .lock()
            .map_err(|_| "mcp_child lock poisoned")?;
        *guard = Some(child);
    }

    wait_for_tcp_port(mcp_port, 8_000)?;
    if !bridge_is_healthy(&inner) {
        stop_mcp_child(&inner);
        kill_stale_cc_wf_studio_mcp_listeners(mcp_port);
        let mut g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
        *g = None;
        return Err("MCP HTTP 子进程未能成功监听 6282".into());
    }

    write_claude_project_mcp_json(&project, mcp_port)?;

    Ok(CcWfStudioMcpBridgeStatus {
        running: true,
        port: Some(mcp_port as u32),
    })
}

#[tauri::command]
pub async fn ensure_cc_workflow_studio_project_mcp(
    app: AppHandle,
    project_path: String,
) -> Result<(), String> {
    start_cc_wf_studio_mcp_bridge(app, project_path).await?;
    Ok(())
}

#[tauri::command]
pub fn stop_cc_wf_studio_mcp_bridge() -> Result<(), String> {
    let mut g = bridge_cell().lock().map_err(|_| "bridge lock poisoned")?;
    if let Some(inner) = g.take() {
        stop_mcp_child(&inner);
    }
    kill_stale_cc_wf_studio_mcp_listeners(DEFAULT_MCP_PORT);
    Ok(())
}
