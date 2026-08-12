//! Protocol types for the Codex App-Server JSON-RPC protocol (Phase 1 minimal set).
//!
//! These types model the `initialize`, `thread/*`, `turn/*`, and key server
//! notifications needed to drive a basic conversation session.
//!
//! Phase 2 adds server-initiated request types (approval requests) and the
//! ability for the client to respond.
//!
//! Phase 3 adds MCP (Model Context Protocol) types: server status listing,
//! elicitation requests, OAuth login, and direct tool invocation.
//!
//! Phase 4 adds sandbox command execution (`command/exec/*`) and filesystem
//! operations (`fs/*`).
//!
//! Phase 5 adds thread management (list, archive, fork, read, delete),
//! turn steering (`turn/steer`), code review (`review/start`), skills
//! listing (`skills/list`), and dynamic tool call server requests
//! (`item/tool/call`).

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

/// Parameters for the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub client_info: ClientInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ClientCapabilities>,
}

/// Client identification sent during initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// Optional client capabilities advertised at initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experimental_api: Option<bool>,
}

/// Response payload from the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_home: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_os: Option<String>,
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/// Parameters for the `thread/start` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// 可选配置覆盖（与 CLI `-c key=value` / config.toml 同源键名）。
    /// 例如 `sandbox_mode`、`approval_policy`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<std::collections::HashMap<String, serde_json::Value>>,
}

/// Response payload from `thread/start`.
///
/// Wire shape: `{ "thread": { "id": "thr_…", … } }` (not a bare `{ "id": … }`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartResponse {
    pub thread: ThreadInfo,
}

/// Parameters for the `thread/resume` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeParams {
    pub thread_id: String,
}

/// Response payload from `thread/resume` (same envelope as `thread/start`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeResponse {
    pub thread: ThreadInfo,
}

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

/// Parameters for the `turn/start` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartParams {
    pub thread_id: String,
    /// App-server expects an array of input items, e.g. `[{ "type": "text", "text": "…" }]`.
    pub input: Vec<TurnInputItem>,
    /// Per-turn reasoning effort override (`minimal` / `low` / `medium` / `high` / `xhigh` / `ultra`).
    /// When set, becomes the default for later turns on the same thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

/// One user input item for `turn/start` / `turn/steer`.
///
/// Wire shape (Codex app-server v2 `UserInput`):
/// - `{"type":"text","text":"…"}`
/// - `{"type":"localImage","path":"/abs/path.png"}` — server reads pixels from disk
/// - `{"type":"image","url":"data:image/png;base64,…"}` — inline data URL only (HTTP(S) rejected)
///
/// Optional `detail` (`high` / `original` / …) is forwarded when set; omitted → server default (`high`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TurnInputItem {
    Text {
        text: String,
    },
    LocalImage {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Image {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

impl TurnInputItem {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    pub fn local_image(path: impl Into<String>) -> Self {
        Self::LocalImage {
            path: path.into(),
            detail: None,
        }
    }

    pub fn image_data_url(url: impl Into<String>) -> Self {
        Self::Image {
            url: url.into(),
            detail: None,
        }
    }
}

/// Backward-compatible alias used by older call sites / docs.
pub type TurnInput = TurnInputItem;

/// Trim trailing CJK/ASCII punctuation commonly glued to `@/path` in bubble text.
fn trim_composer_attachment_path(raw: &str) -> String {
    let trimmed = raw.trim();
    let cut = trimmed
        .char_indices()
        .rev()
        .find(|(_, ch)| {
            !matches!(
                *ch,
                '。' | '．'
                    | '.'
                    | '，'
                    | ','
                    | '；'
                    | ';'
                    | '！'
                    | '!'
                    | '？'
                    | '?'
                    | '）'
                    | ')'
                    | ']'
                    | '」'
                    | '』'
                    | '"'
                    | '\''
                    | '`'
            )
        })
        .map(|(i, ch)| i + ch.len_utf8())
        .unwrap_or(0);
    trimmed[..cut].to_string()
}

/// 从 Wise Composer outbound（`附图：@/abs/path …`）解析本地图片绝对路径。
pub fn extract_composer_image_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    // 每个 `附图：` 行段内可有多个 `@/path`
    let block_re = regex::Regex::new(r"附图[：:]([^\n]*)").expect("附图 block regex");
    let path_re = regex::Regex::new(r"@(/[^\s]+)").expect("@path regex");
    for block in block_re.captures_iter(text) {
        let segment = block.get(1).map(|m| m.as_str()).unwrap_or("");
        for cap in path_re.captures_iter(segment) {
            let p = trim_composer_attachment_path(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
            if !p.is_empty() && !paths.iter().any(|x| x == &p) {
                paths.push(p);
            }
        }
    }
    // 兼容正文里直接写 `data:image/...;base64,...`（无落盘路径时）
    let data_re =
        regex::Regex::new(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)").expect("data url");
    for cap in data_re.captures_iter(text) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        if !url.is_empty() && !paths.iter().any(|x| x == &url) {
            paths.push(url);
        }
    }
    paths
}

/// 去掉 `附图：…` 块，与前端 `stripComposerAttachedImageSuffix` 对齐。
///
/// 纯附图（整段只有 `附图：@…`、无正文）会得到空字符串，避免再塞进 text item。
pub fn strip_composer_attached_image_suffix(text: &str) -> String {
    let trimmed = text.trim_end();
    let only_attachment =
        regex::Regex::new(r"^[ \t\n\r\u{2028}\u{2029}]*附图[：:][\s\S]*$").expect("only 附图");
    if only_attachment.is_match(trimmed) {
        return String::new();
    }
    let re = regex::Regex::new(r"(?:[ \t\n\r\u{2028}\u{2029}])+附图[：:][\s\S]*$")
        .expect("附图 suffix regex");
    re.replace(trimmed, "").trim_end().to_string()
}

/// app-server `image` 单张上限（与 Codex 高水位 sanity guard 同量级，避免撑爆 stdio JSON-RPC）。
const MAX_TURN_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

fn mime_from_image_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        Some("heic") | Some("heif") => "image/heic",
        _ => "image/png",
    }
}

/// 把本地图片读成 app-server `image` data URL。
///
/// 优先走 inline `image`（像素直接进 turn/start），避免仅发 `localImage` 时模型只看到
/// path 标签、vision 失败后再去 OCR 的路径。读盘失败时由调用方回退 `localImage`。
pub fn local_image_path_to_data_url(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("图片路径为空".to_string());
    }
    if trimmed.starts_with("data:image/") {
        return Ok(trimmed.to_string());
    }
    let path_buf = std::path::PathBuf::from(trimmed);
    if !path_buf.is_absolute() {
        return Err("图片路径必须是绝对路径".to_string());
    }
    let meta = std::fs::metadata(&path_buf).map_err(|e| format!("无法读取图片元数据: {e}"))?;
    if !meta.is_file() {
        return Err("图片路径不是文件".to_string());
    }
    if meta.len() > MAX_TURN_IMAGE_BYTES {
        return Err(format!(
            "图片过大（{} bytes，上限 {}）",
            meta.len(),
            MAX_TURN_IMAGE_BYTES
        ));
    }
    let bytes = std::fs::read(&path_buf).map_err(|e| format!("无法读取图片: {e}"))?;
    if bytes.is_empty() {
        return Err("图片文件为空".to_string());
    }
    let mime = mime_from_image_path(&path_buf);
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// 粗判模型是否支持多模态识图（app-server `input_modalities` 的启发式替代）。
///
/// DeepSeek / 多数纯文本 Coding Plan 模型会把 `image` 变成 `[Unsupported Image]`；
/// 对这些模型绝不能发 image/localImage item，应保留 `附图：@path` 文本供工具链读取。
pub fn model_likely_supports_image_input(model: Option<&str>) -> bool {
    let Some(raw) = model.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let n = raw.to_ascii_lowercase();
    // 明确无视觉
    if n.contains("deepseek")
        || n.contains("moonshot")
        || n.contains("kimi")
        || n.contains("minimax")
        || n.contains("glm-4")
        || (n.contains("qwen") && !n.contains("vl") && !n.contains("vision"))
    {
        return false;
    }
    // 明确有视觉 / OpenAI 系 Codex
    n.contains("gpt-4o")
        || n.contains("gpt-4.1")
        || n.contains("gpt-5")
        || n.contains("gpt-4-turbo")
        || n.starts_with("o1")
        || n.starts_with("o3")
        || n.starts_with("o4")
        || n.contains("codex")
        || n.contains("claude")
        || n.contains("gemini")
        || n.contains("vision")
        || n.contains("-vl")
        || n.contains("vl-")
}

/// 将 Composer 发出的纯文本（含 `附图：@path`）拆成 app-server `turn/start` input items。
///
/// - 识图模型：本地图优先读盘为 `image` data URL；失败再退回 `localImage`；剥离 `附图：` 文本。
/// - 非识图模型：不发 image item（避免 `[Unsupported Image]`），保留完整 `附图：@path` 文本。
pub fn build_turn_input_items_from_composer_prompt(prompt: &str) -> Vec<TurnInputItem> {
    build_turn_input_items_from_composer_prompt_for_model(prompt, None)
}

pub fn build_turn_input_items_from_composer_prompt_for_model(
    prompt: &str,
    model: Option<&str>,
) -> Vec<TurnInputItem> {
    let paths = extract_composer_image_paths(prompt);
    let vision = model_likely_supports_image_input(model);

    if paths.is_empty() {
        let trimmed = prompt.trim();
        return if trimmed.is_empty() {
            Vec::new()
        } else {
            vec![TurnInputItem::text(trimmed.to_string())]
        };
    }

    if !vision {
        eprintln!(
            "[codex_rpc] model {:?} lacks image input; keep 附图 paths in text ({} file(s))",
            model.unwrap_or(""),
            paths.len()
        );
        let trimmed = prompt.trim();
        return if trimmed.is_empty() {
            Vec::new()
        } else {
            vec![TurnInputItem::text(trimmed.to_string())]
        };
    }

    let mut text = strip_composer_attached_image_suffix(prompt);
    // 去掉已抽成 image 项的 data URL，避免正文重复塞进超长 base64
    for p in &paths {
        if p.starts_with("data:image/") {
            text = text.replace(p, "");
        }
    }
    text = text.trim().to_string();

    let mut items = Vec::new();
    if !text.is_empty() {
        items.push(TurnInputItem::text(text));
    }
    for path in paths {
        if path.starts_with("data:image/") {
            items.push(TurnInputItem::image_data_url(path));
            continue;
        }
        match local_image_path_to_data_url(&path) {
            Ok(data_url) => {
                eprintln!(
                    "[codex_rpc] turn input image: inlined data URL ({} bytes path)",
                    path.len()
                );
                items.push(TurnInputItem::Image {
                    url: data_url,
                    // 与 app-server 默认一致；明确 high 避免个别版本忽略缺省
                    detail: Some("high".to_string()),
                });
            }
            Err(err) => {
                eprintln!(
                    "[codex_rpc] turn input image: inline failed ({err}), fallback localImage path={path}"
                );
                items.push(TurnInputItem::local_image(path));
            }
        }
    }
    if items.is_empty() {
        let trimmed = prompt.trim();
        if !trimmed.is_empty() {
            items.push(TurnInputItem::text(trimmed.to_string()));
        }
    }
    items
}

/// Turn metadata returned by `turn/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Response payload from `turn/start`.
///
/// Wire shape: `{ "turn": { "id": "turn_…", "status": "inProgress", … } }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartResponse {
    pub turn: TurnInfo,
}

/// Parameters for the `turn/interrupt` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub turn_id: String,
}

// ---------------------------------------------------------------------------
// Server Notifications
// ---------------------------------------------------------------------------

/// Thread metadata embedded in `thread/started` notifications.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A thread item (user message, agent message, command execution, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadItem {
    pub id: String,
    /// Item type discriminator: `"userMessage"`, `"agentMessage"`, `"commandExecution"`, etc.
    #[serde(default, rename = "type", alias = "item_type")]
    pub item_type: String,
    /// Raw JSON for forward compatibility — fields we don't model yet.
    #[serde(flatten)]
    pub raw: Value,
}

/// Typed server notifications dispatched by the app-server.
///
/// The wire format uses `"method": "thread/started"` etc. as the discriminator.
/// We parse with a manual `parse_notification` function for robustness against
/// unknown methods.
#[derive(Debug, Clone)]
pub enum ServerNotification {
    ThreadStarted {
        thread: ThreadInfo,
    },
    ThreadClosed {
        thread_id: String,
    },
    TurnStarted {
        turn_id: String,
        thread_id: String,
    },
    TurnCompleted {
        turn_id: String,
        thread_id: String,
        status: String,
        /// Populated when the turn failed (`status` is `failed` / `errored` / …).
        error_message: Option<String>,
    },
    ItemStarted {
        item_id: String,
        turn_id: String,
        item: ThreadItem,
    },
    ItemCompleted {
        item_id: String,
        turn_id: String,
        item: ThreadItem,
    },
    AgentMessageDelta {
        item_id: String,
        delta: String,
    },
    CommandExecutionOutputDelta {
        item_id: String,
        delta: String,
        stream: String,
    },
    Error {
        code: i64,
        message: String,
        data: Option<Value>,
    },
    /// A server-initiated request has been resolved (e.g. approval completed).
    ServerRequestResolved {
        thread_id: String,
        request_id: u64,
    },
    /// MCP server status changed (connecting, ready, failed, etc.).
    McpServerStatusUpdated {
        name: String,
        status: String,
        error: Option<String>,
    },
    /// MCP OAuth login completed for a server.
    McpOAuthLoginCompleted {
        name: String,
        success: bool,
        error: Option<String>,
    },
    /// Catch-all for notifications not yet modelled.
    Unknown {
        method: String,
        params: Option<Value>,
    },
    // --- Phase 4: Command execution & filesystem notifications ---
    /// `command/exec/outputDelta` — streamed output chunk for a running command.
    CommandExecOutputDeltaNotification {
        process_id: String,
        stream: String,
        delta_base64: String,
        cap_reached: bool,
    },
    /// `fs/changed` — filesystem watch notification.
    FsChanged {
        watch_id: String,
        changed_paths: Vec<String>,
    },
    /// `process/outputDelta` — streamed output chunk for a `process/spawn` run.
    /// Reuses the same shape as `command/exec/outputDelta` (base64 chunks).
    ProcessOutputDeltaNotification {
        process_id: String,
        stream: String,
        delta_base64: String,
        cap_reached: bool,
    },
    /// `process/exited` — final exit notification for a `process/spawn` run.
    ProcessExited {
        process_id: String,
        exit_code: i64,
        stdout: String,
        stderr: String,
    },
    /// `item/reasoning/textDelta` / `item/reasoning/summaryTextDelta` — reasoning
    /// content / summary increments streamed while the item is in progress.
    ReasoningTextDelta {
        item_id: String,
        delta: String,
    },
    /// `item/plan/delta` — proposed plan streaming deltas (EXPERIMENTAL).
    PlanDelta {
        item_id: String,
        delta: String,
    },
    /// `item/fileChange/patchUpdated` — live patch changes before the item completes.
    FileChangePatchUpdated {
        item_id: String,
        changes: Value,
    },
    /// `warning` / `guardianWarning` — concise system warning for the user.
    Warning {
        message: String,
        thread_id: Option<String>,
    },
    /// `hook/started` — a Codex hook (PreToolUse / PostToolUse / …) began running.
    HookStarted {
        thread_id: String,
        run: Value,
    },
    /// `hook/completed` — a Codex hook finished (completed / failed / blocked / stopped).
    HookCompleted {
        thread_id: String,
        run: Value,
    },
    /// `configWarning` — concise configuration warning (summary + optional details/path).
    ConfigWarning {
        summary: String,
        details: Option<String>,
        path: Option<String>,
    },
    /// `deprecationNotice` — a feature / configuration deprecation notice.
    DeprecationNotice {
        summary: String,
        details: Option<String>,
    },
    /// `thread/status/changed` — the thread lifecycle status changed
    /// (`NotLoaded` / `Idle` / `SystemError` / `Active{…}`).
    ThreadStatusChanged {
        thread_id: String,
        status: Value,
    },
    /// `thread/name/updated` — the thread name changed (via `thread/setName`).
    ThreadNameUpdated {
        thread_id: String,
        thread_name: Option<String>,
    },
    /// `thread/compacted` — the thread context was compacted.
    ThreadCompacted {
        thread_id: String,
    },
    /// `item/autoApprovalReview/started` — approval auto-review begins.
    AutoApprovalReviewStarted {
        review_id: String,
        target_item_id: Option<String>,
        action: Value,
        review: Value,
    },
    /// `item/autoApprovalReview/completed` — approval auto-review finished.
    AutoApprovalReviewCompleted {
        review_id: String,
        target_item_id: Option<String>,
        action: Value,
        review: Value,
        decision_source: Option<String>,
    },
    /// `turn/tokenUsage/updated` — real token usage for the active turn.
    ThreadTokenUsageUpdated {
        thread_id: String,
        turn_id: String,
        token_usage: Value,
    },
    /// `model/rerouted` — the model was rerouted to another model mid-turn.
    ModelRerouted {
        thread_id: String,
        turn_id: String,
        from_model: String,
        to_model: String,
        reason: Option<String>,
    },
    // --- Phase 5: Turn plan / diff notifications ---
    /// `turn/planUpdated` — the agent's plan has been updated.
    TurnPlanUpdated {
        thread_id: String,
        turn_id: String,
        /// `TurnPlanStep[]` as raw JSON (steps carry `status` + `step` text).
        plan: Option<Value>,
        /// Optional explanation accompanying the plan update.
        explanation: Option<String>,
    },
    /// `turn/diffUpdated` — the cumulative diff has been updated.
    TurnDiffUpdated {
        thread_id: String,
        turn_id: String,
        diff: Option<String>,
    },
}

/// Extract a human-readable message from Codex app-server `error` / `TurnError` params.
///
/// Recent app-server builds often put the useful bits in `codexErrorInfo` /
/// `additionalDetails` instead of a top-level `message` string — missing those
/// used to surface as the useless `Unknown error`.
pub fn extract_error_notification_message(p: &Value) -> String {
    if let Some(s) = non_empty_str(p.get("message")) {
        return s.to_string();
    }
    if let Some(err) = p.get("error") {
        if let Some(s) = err.as_str().map(str::trim).filter(|s| !s.is_empty()) {
            return s.to_string();
        }
        if let Some(s) = non_empty_str(err.get("message")) {
            return s.to_string();
        }
        if let Some(info) = err
            .get("codexErrorInfo")
            .or_else(|| err.get("codex_error_info"))
        {
            let formatted = format_codex_error_info(info);
            if !formatted.is_empty() {
                return formatted;
            }
        }
        if let Some(s) = non_empty_str(
            err.get("additionalDetails")
                .or_else(|| err.get("additional_details")),
        ) {
            return s.to_string();
        }
    }
    if let Some(s) = non_empty_str(
        p.get("additionalDetails")
            .or_else(|| p.get("additional_details")),
    ) {
        return s.to_string();
    }
    if let Some(info) = p
        .get("codexErrorInfo")
        .or_else(|| p.get("codex_error_info"))
    {
        let formatted = format_codex_error_info(info);
        if !formatted.is_empty() {
            return formatted;
        }
    }
    if p.is_null() || p.as_object().is_some_and(|m| m.is_empty()) {
        return "Unknown error".to_string();
    }
    let compact = serde_json::to_string(p).unwrap_or_else(|_| p.to_string());
    if compact.len() > 400 {
        format!("{}…", &compact[..400])
    } else {
        compact
    }
}

fn non_empty_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn format_codex_error_info(info: &Value) -> String {
    if let Some(s) = info.as_str().map(str::trim).filter(|s| !s.is_empty()) {
        return s.to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    if let Some(t) = non_empty_str(info.get("type")).or_else(|| non_empty_str(info.get("code"))) {
        parts.push(t.to_string());
    }
    if let Some(code) = info
        .get("httpStatusCode")
        .or_else(|| info.get("http_status_code"))
    {
        parts.push(format!("http {code}"));
    }
    if let Some(m) = non_empty_str(info.get("message")) {
        parts.push(m.to_string());
    }
    if !parts.is_empty() {
        return parts.join(": ");
    }
    // Internally-tagged / single-variant object: `{ "unauthorized": { "httpStatusCode": 401 } }`
    if let Some(obj) = info.as_object() {
        if let Some((variant, payload)) = obj.iter().next() {
            let mut bits = vec![variant.clone()];
            if let Some(code) = payload
                .get("httpStatusCode")
                .or_else(|| payload.get("http_status_code"))
            {
                bits.push(format!("http {code}"));
            }
            if let Some(m) = non_empty_str(payload.get("message")) {
                bits.push(m.to_string());
            } else if payload.is_object() && payload.as_object().is_some_and(|m| !m.is_empty()) {
                if let Ok(compact) = serde_json::to_string(payload) {
                    bits.push(compact);
                }
            }
            return bits.join(": ");
        }
    }
    String::new()
}

/// Parse a raw `(method, params)` pair from the transport into a typed notification.
///
/// Unknown method names are mapped to [`ServerNotification::Unknown`] so the
/// caller can decide whether to log, ignore, or forward them.
pub fn parse_notification(method: &str, params: Option<Value>) -> ServerNotification {
    let p = params.unwrap_or(Value::Null);
    match method {
        "thread/started" => {
            let thread = parse_thread_info(&p);
            ServerNotification::ThreadStarted { thread }
        }
        "thread/closed" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::ThreadClosed { thread_id }
        }
        "turn/started" => {
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::TurnStarted { turn_id, thread_id }
        }
        "turn/completed" | "turn/finished" => {
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let status = p
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed")
                .to_string();
            let error_message = p
                .get("error")
                .map(extract_error_notification_message)
                .filter(|s| !s.is_empty() && s != "Unknown error");
            ServerNotification::TurnCompleted {
                turn_id,
                thread_id,
                status,
                error_message,
            }
        }
        "item/started" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item = parse_thread_item(p.get("item"));
            ServerNotification::ItemStarted {
                item_id,
                turn_id,
                item,
            }
        }
        "item/completed" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item = parse_thread_item(p.get("item"));
            ServerNotification::ItemCompleted {
                item_id,
                turn_id,
                item,
            }
        }
        "item/agentMessage/delta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::AgentMessageDelta { item_id, delta }
        }
        "item/commandExecution/outputDelta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stream = p
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string();
            ServerNotification::CommandExecutionOutputDelta { item_id, delta, stream }
        }
        "error" => {
            let code = p
                .get("code")
                .and_then(Value::as_i64)
                .or_else(|| {
                    p.get("codexErrorInfo")
                        .or_else(|| p.get("codex_error_info"))
                        .and_then(|info| {
                            info.get("httpStatusCode")
                                .or_else(|| info.get("http_status_code"))
                        })
                        .and_then(Value::as_i64)
                })
                .unwrap_or(0);
            let message = extract_error_notification_message(&p);
            eprintln!("[codex_rpc] error notification: {message}");
            let data = Some(p.clone());
            ServerNotification::Error {
                code,
                message,
                data,
            }
        }
        "mcpServer/statusUpdated"
        | "mcpServer/startupStatus/updated"
        | "mcp/serverStatusUpdated" => {
            let name = p
                .get("name")
                .or_else(|| p.get("server_name"))
                .or_else(|| p.get("serverName"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let status = p
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let error = p
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::McpServerStatusUpdated { name, status, error }
        }
        "mcpServer/oauthLoginCompleted"
        | "mcpServer/oauthLogin/completed"
        | "mcp/oauthLoginCompleted" => {
            let name = p
                .get("name")
                .or_else(|| p.get("server"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let success = p
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let error = p
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::McpOAuthLoginCompleted { name, success, error }
        }
        "serverRequest/resolved" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let request_id = p
                .get("requestId")
                .or_else(|| p.get("request_id"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            ServerNotification::ServerRequestResolved {
                thread_id,
                request_id,
            }
        }
        "command/exec/outputDelta" => {
            let process_id = p
                .get("processId")
                .or_else(|| p.get("process_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stream = p
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string();
            let delta_base64 = p
                .get("deltaBase64")
                .or_else(|| p.get("delta_base64"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cap_reached = p
                .get("capReached")
                .or_else(|| p.get("cap_reached"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            ServerNotification::CommandExecOutputDeltaNotification {
                process_id,
                stream,
                delta_base64,
                cap_reached,
            }
        }
        "process/outputDelta" => {
            let process_id = p
                .get("processHandle")
                .or_else(|| p.get("process_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stream = p
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string();
            let delta_base64 = p
                .get("deltaBase64")
                .or_else(|| p.get("delta_base64"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cap_reached = p
                .get("capReached")
                .or_else(|| p.get("cap_reached"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            ServerNotification::ProcessOutputDeltaNotification {
                process_id,
                stream,
                delta_base64,
                cap_reached,
            }
        }
        "process/exited" => {
            let process_id = p
                .get("processHandle")
                .or_else(|| p.get("process_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let exit_code = p
                .get("exitCode")
                .or_else(|| p.get("exit_code"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let stdout = p
                .get("stdout")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stderr = p
                .get("stderr")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::ProcessExited {
                process_id,
                exit_code,
                stdout,
                stderr,
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::ReasoningTextDelta { item_id, delta }
        }
        "item/plan/delta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::PlanDelta { item_id, delta }
        }
        "item/fileChange/patchUpdated" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let changes = p.get("changes").cloned().unwrap_or(Value::Null);
            ServerNotification::FileChangePatchUpdated { item_id, changes }
        }
        "warning" | "guardianWarning" => {
            let message = p
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::Warning { message, thread_id }
        }
        "hook/started" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let run = p.get("run").cloned().unwrap_or(Value::Null);
            ServerNotification::HookStarted { thread_id, run }
        }
        "hook/completed" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let run = p.get("run").cloned().unwrap_or(Value::Null);
            ServerNotification::HookCompleted { thread_id, run }
        }
        "configWarning" => {
            let summary = p
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let details = p
                .get("details")
                .and_then(Value::as_str)
                .map(str::to_string);
            let path = p
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::ConfigWarning {
                summary,
                details,
                path,
            }
        }
        "deprecationNotice" => {
            let summary = p
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let details = p
                .get("details")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::DeprecationNotice { summary, details }
        }
        "thread/status/changed" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let status = p.get("status").cloned().unwrap_or(Value::Null);
            ServerNotification::ThreadStatusChanged { thread_id, status }
        }
        "thread/name/updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_name = p
                .get("threadName")
                .or_else(|| p.get("thread_name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::ThreadNameUpdated {
                thread_id,
                thread_name,
            }
        }
        "thread/compacted" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::ThreadCompacted { thread_id }
        }
        "item/autoApprovalReview/started" => {
            let review_id = p
                .get("reviewId")
                .or_else(|| p.get("review_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let target_item_id = p
                .get("targetItemId")
                .or_else(|| p.get("target_item_id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let action = p.get("action").cloned().unwrap_or(Value::Null);
            let review = p.get("review").cloned().unwrap_or(Value::Null);
            ServerNotification::AutoApprovalReviewStarted {
                review_id,
                target_item_id,
                action,
                review,
            }
        }
        "item/autoApprovalReview/completed" => {
            let review_id = p
                .get("reviewId")
                .or_else(|| p.get("review_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let target_item_id = p
                .get("targetItemId")
                .or_else(|| p.get("target_item_id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let action = p.get("action").cloned().unwrap_or(Value::Null);
            let review = p.get("review").cloned().unwrap_or(Value::Null);
            let decision_source = p
                .get("decisionSource")
                .or_else(|| p.get("decision_source"))
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::AutoApprovalReviewCompleted {
                review_id,
                target_item_id,
                action,
                review,
                decision_source,
            }
        }
        "turn/tokenUsage/updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let token_usage = p
                .get("tokenUsage")
                .or_else(|| p.get("token_usage"))
                .cloned()
                .unwrap_or(Value::Null);
            ServerNotification::ThreadTokenUsageUpdated {
                thread_id,
                turn_id,
                token_usage,
            }
        }
        "model/rerouted" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let from_model = p
                .get("fromModel")
                .or_else(|| p.get("from_model"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let to_model = p
                .get("toModel")
                .or_else(|| p.get("to_model"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let reason = p
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::ModelRerouted {
                thread_id,
                turn_id,
                from_model,
                to_model,
                reason,
            }
        }
        "fs/changed" => {
            let watch_id = p
                .get("watchId")
                .or_else(|| p.get("watch_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let changed_paths = p
                .get("changedPaths")
                .or_else(|| p.get("changed_paths"))
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            ServerNotification::FsChanged {
                watch_id,
                changed_paths,
            }
        }
        "turn/planUpdated" | "turn/plan_updated" | "turn/plan/updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            // schema: `plan` 是 `TurnPlanStep[]`（status + step），存原始数组由适配器格式化。
            let plan = p.get("plan").cloned();
            let explanation = p
                .get("explanation")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::TurnPlanUpdated {
                thread_id,
                turn_id,
                plan,
                explanation,
            }
        }
        "turn/diffUpdated" | "turn/diff_updated" | "turn/diff/updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let diff = p
                .get("diff")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::TurnDiffUpdated { thread_id, turn_id, diff }
        }
        _ => ServerNotification::Unknown {
            method: method.to_string(),
            params: Some(p),
        },
    }
}

// ---------------------------------------------------------------------------
// Server-initiated requests (Phase 2)
// ---------------------------------------------------------------------------

/// Server-initiated request (the server asks the client for something).
///
/// The Codex App-Server protocol is **bidirectional**: the server sends
/// requests TO the client (for approvals, tool calls, elicitation), and the
/// client must respond with a matching JSON-RPC response message.
#[derive(Debug, Clone)]
pub enum ServerRequest {
    /// `item/commandExecution/requestApproval` — the server wants the user to
    /// approve (or decline) a command before it runs.
    CommandExecutionRequestApproval {
        request_id: u64,
        params: CommandExecutionApprovalParams,
    },
    /// `item/fileChange/requestApproval` — the server wants the user to
    /// approve (or decline) proposed file changes.
    FileChangeRequestApproval {
        request_id: u64,
        params: FileChangeApprovalParams,
    },
    /// `mcpServer/elicitation/create` — the server wants user input (elicitation).
    McpServerElicitationRequest {
        request_id: u64,
        params: McpElicitationParams,
    },
    /// `item/tool/call` — the server wants the client to execute a dynamic tool.
    DynamicToolCall {
        request_id: u64,
        params: DynamicToolCallRequestParams,
    },
    /// Catch-all for server request methods not yet modelled.
    Unknown {
        request_id: u64,
        method: String,
        params: Option<Value>,
    },
}

/// Parse a raw `(id, method, params)` tuple from the transport into a typed
/// [`ServerRequest`].
pub fn parse_server_request(
    id: u64,
    method: &str,
    params: Option<Value>,
) -> ServerRequest {
    match method {
        "item/commandExecution/requestApproval" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::CommandExecutionRequestApproval {
                request_id: id,
                params: p,
            }
        }
        "item/fileChange/requestApproval" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::FileChangeRequestApproval {
                request_id: id,
                params: p,
            }
        }
        method if method.starts_with("mcpServer/elicitation") || method == "mcp/elicitation/create" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::McpServerElicitationRequest {
                request_id: id,
                params: p,
            }
        }
        "item/tool/call" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::DynamicToolCall {
                request_id: id,
                params: p,
            }
        }
        _ => ServerRequest::Unknown {
            request_id: id,
            method: method.to_string(),
            params,
        },
    }
}

/// Parameters for `item/commandExecution/requestApproval`.
///
/// Fields are optional for forward-compatibility — the server may add new
/// fields without breaking older clients.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionApprovalParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_decisions: Option<Vec<String>>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Parameters for `item/fileChange/requestApproval`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeApprovalParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// MCP Types (Phase 3)
// ---------------------------------------------------------------------------

/// MCP server status entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_status: Option<String>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Response from `mcpServer/listStatuses`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusListResponse {
    pub data: Vec<McpServerStatusInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Parameters for `mcpServer/tool/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallParams {
    pub server: String,
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response from `mcpServer/tool/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResponse {
    #[serde(default)]
    pub content: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
}

/// Parameters for `mcpServer/oauth/login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthLoginParams {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response from `mcpServer/oauth/login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthLoginResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
}

/// Parameters for an MCP elicitation server request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_schema: Option<Value>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Elicitation response payload sent back to the server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationResponse {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
}

/// Approval decision sent back to the server in a JSON-RPC response.
///
/// Shared by both command-execution and file-change approval flows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
    Cancel,
}

// ---------------------------------------------------------------------------
// Command Execution Types (Phase 4)
// ---------------------------------------------------------------------------

/// PTY size in character cells for `command/exec` PTY sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecTerminalSize {
    pub rows: u16,
    pub cols: u16,
}

/// Parameters for the `command/exec` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecParams {
    /// Command argv vector. Empty arrays are rejected.
    pub command: Vec<String>,
    /// Optional client-supplied, connection-scoped process id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    /// Enable PTY mode (implies streamStdin and streamStdoutStderr).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tty: bool,
    /// Allow follow-up `command/exec/write` requests to write stdin bytes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stream_stdin: bool,
    /// Stream stdout/stderr via `command/exec/outputDelta` notifications.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stream_stdout_stderr: bool,
    /// Optional timeout in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
    /// Optional working directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Optional environment overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, Option<String>>>,
    /// Optional initial PTY size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<CommandExecTerminalSize>,
}

/// Final buffered result for `command/exec`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Write stdin bytes to a running `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecWriteParams {
    pub process_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_base64: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub close_stdin: bool,
}

/// Terminate a running `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecTerminateParams {
    pub process_id: String,
}

/// Resize a running PTY-backed `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecResizeParams {
    pub process_id: String,
    pub size: CommandExecTerminalSize,
}

// ---------------------------------------------------------------------------
// Filesystem Types (Phase 4)
// ---------------------------------------------------------------------------

/// Parameters for `fs/readFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileParams {
    pub path: String,
}

/// Response from `fs/readFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileResponse {
    pub data_base64: String,
}

/// Parameters for `fs/writeFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileParams {
    pub path: String,
    pub data_base64: String,
}

/// Parameters for `fs/createDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCreateDirectoryParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
}

/// Parameters for `fs/getMetadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGetMetadataParams {
    pub path: String,
}

/// Response from `fs/getMetadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGetMetadataResponse {
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub created_at_ms: i64,
    pub modified_at_ms: i64,
}

/// Parameters for `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryParams {
    pub path: String,
}

/// A directory entry returned by `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryEntry {
    pub file_name: String,
    pub is_directory: bool,
    pub is_file: bool,
}

/// Response from `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryResponse {
    pub entries: Vec<FsReadDirectoryEntry>,
}

/// Parameters for `fs/remove`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRemoveParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

/// Parameters for `fs/copy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCopyParams {
    pub source_path: String,
    pub destination_path: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub recursive: bool,
}

/// Parameters for `fs/watch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWatchParams {
    pub watch_id: String,
    pub path: String,
}

/// Response from `fs/watch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWatchResponse {
    pub path: String,
}

/// Parameters for `fs/unwatch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsUnwatchParams {
    pub watch_id: String,
}

// ---------------------------------------------------------------------------
// Thread management types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `thread/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

/// Response from `thread/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResponse {
    pub data: Vec<ThreadSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
}

/// A thread summary entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Parameters for `thread/archive`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadArchiveParams {
    pub thread_id: String,
}

/// Parameters for `thread/unarchive`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUnarchiveParams {
    pub thread_id: String,
}

/// Parameters for `thread/delete`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDeleteParams {
    pub thread_id: String,
}

/// Parameters for `thread/fork`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadForkParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Parameters for `thread/read`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadParams {
    pub thread_id: String,
}

// ---------------------------------------------------------------------------
// Turn steering types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `turn/steer`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub turn_id: String,
    /// Same input-item array shape as `turn/start` (text / localImage / image).
    pub input: Vec<TurnInputItem>,
}

// ---------------------------------------------------------------------------
// Code review types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `review/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStartParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
}

/// Response from `review/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStartResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Skills types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `skills/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// A skill info entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Dynamic tool call types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for an `item/tool/call` server request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallRequestParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_thread_info(v: &Value) -> ThreadInfo {
    let thread_obj = v.get("thread").unwrap_or(v);
    let id = thread_obj
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let name = thread_obj
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string);
    ThreadInfo { id, name }
}

fn parse_thread_item(v: Option<&Value>) -> ThreadItem {
    match v {
        Some(val) => {
            let id = val
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item_type = val
                .get("type")
                .or_else(|| val.get("item_type"))
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            ThreadItem {
                id,
                item_type,
                raw: val.clone(),
            }
        }
        None => ThreadItem {
            id: String::new(),
            item_type: "unknown".to_string(),
            raw: Value::Null,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_thread_start_response_envelope() {
        let raw = serde_json::json!({
            "thread": {
                "id": "thr_123",
                "sessionId": "thr_123",
                "preview": "",
                "ephemeral": false,
                "modelProvider": "openai",
                "createdAt": 1730910000
            },
            "model": "gpt-5.4",
            "cwd": "/tmp/demo"
        });
        let parsed: ThreadStartResponse = serde_json::from_value(raw).expect("parse");
        assert_eq!(parsed.thread.id, "thr_123");
    }

    #[test]
    fn parses_turn_start_response_envelope() {
        let raw = serde_json::json!({
            "turn": {
                "id": "turn_456",
                "status": "inProgress",
                "items": [],
                "error": null
            }
        });
        let parsed: TurnStartResponse = serde_json::from_value(raw).expect("parse");
        assert_eq!(parsed.turn.id, "turn_456");
        assert_eq!(parsed.turn.status.as_deref(), Some("inProgress"));
    }

    #[test]
    fn serializes_turn_start_input_as_item_array() {
        let params = TurnStartParams {
            thread_id: "thr_123".to_string(),
            input: vec![TurnInputItem::text("hello")],
            effort: None,
        };
        let value = serde_json::to_value(&params).expect("serialize");
        assert_eq!(value["threadId"], "thr_123");
        assert_eq!(value["input"][0]["type"], "text");
        assert_eq!(value["input"][0]["text"], "hello");
        assert!(value.get("effort").is_none());
    }

    #[test]
    fn serializes_turn_start_effort() {
        let params = TurnStartParams {
            thread_id: "thr_123".to_string(),
            input: vec![TurnInputItem::text("hello")],
            effort: Some("xhigh".to_string()),
        };
        let value = serde_json::to_value(&params).expect("serialize");
        assert_eq!(value["effort"], "xhigh");
    }

    #[test]
    fn serializes_local_image_and_image_input_items() {
        let params = TurnStartParams {
            thread_id: "thr_img".to_string(),
            input: vec![
                TurnInputItem::text("看这张图"),
                TurnInputItem::local_image("/tmp/shot.png"),
                TurnInputItem::image_data_url("data:image/png;base64,abc"),
            ],
            effort: None,
        };
        let value = serde_json::to_value(&params).expect("serialize");
        assert_eq!(value["input"][0]["type"], "text");
        assert_eq!(value["input"][1]["type"], "localImage");
        assert_eq!(value["input"][1]["path"], "/tmp/shot.png");
        assert!(value["input"][1].get("detail").is_none());
        assert_eq!(value["input"][2]["type"], "image");
        assert_eq!(value["input"][2]["url"], "data:image/png;base64,abc");
    }

    #[test]
    fn extracts_multiple_composer_attachment_paths() {
        let text = "你好\n\n附图：@/Users/x/.wise/composer-images/a.png @/tmp/b.jpg。";
        assert_eq!(
            extract_composer_image_paths(text),
            vec![
                "/Users/x/.wise/composer-images/a.png".to_string(),
                "/tmp/b.jpg".to_string(),
            ]
        );
    }

    #[test]
    fn model_likely_supports_image_input_heuristics() {
        assert!(model_likely_supports_image_input(Some("gpt-5.4")));
        assert!(model_likely_supports_image_input(Some("claude-opus-4")));
        assert!(!model_likely_supports_image_input(Some("deepseek-v4-flash")));
        assert!(!model_likely_supports_image_input(None));
    }

    #[test]
    fn extracts_error_message_from_codex_error_info() {
        let p = serde_json::json!({
            "willRetry": false,
            "codexErrorInfo": {
                "type": "unauthorized",
                "httpStatusCode": 401,
                "message": "Authentication Fails, Your api key is invalid"
            }
        });
        let msg = extract_error_notification_message(&p);
        assert!(msg.contains("unauthorized"));
        assert!(msg.contains("401"));
        assert!(msg.contains("Authentication Fails"));
    }

    #[test]
    fn extracts_error_message_from_nested_turn_error() {
        let p = serde_json::json!({
            "error": {
                "codexErrorInfo": { "unauthorized": { "httpStatusCode": 401 } },
                "additionalDetails": "provider rejected request"
            }
        });
        let msg = extract_error_notification_message(&p);
        assert!(
            msg.contains("401") || msg.contains("provider rejected"),
            "unexpected msg: {msg}"
        );
    }

    #[test]
    fn parses_error_notification_without_top_level_message() {
        let notif = parse_notification(
            "error",
            Some(serde_json::json!({
                "willRetry": false,
                "codexErrorInfo": { "type": "badRequest", "message": "invalid input" }
            })),
        );
        match notif {
            ServerNotification::Error { message, .. } => {
                assert!(message.contains("invalid input"));
            }
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn non_vision_model_keeps_attachment_paths_in_text() {
        let prompt =
            "图片有什么内容？\n\n附图：@/Users/x/.wise/composer-images/demo/uuid-image.png";
        let items =
            build_turn_input_items_from_composer_prompt_for_model(prompt, Some("deepseek-v4-flash"));
        assert_eq!(items, vec![TurnInputItem::text(prompt)]);
    }

    #[test]
    fn builds_turn_input_items_falls_back_to_local_image_when_file_missing() {
        let prompt =
            "图片有什么内容？\n\n附图：@/Users/x/.wise/composer-images/demo/uuid-image.png";
        let items =
            build_turn_input_items_from_composer_prompt_for_model(prompt, Some("gpt-5.4"));
        assert_eq!(
            items,
            vec![
                TurnInputItem::text("图片有什么内容？"),
                TurnInputItem::local_image(
                    "/Users/x/.wise/composer-images/demo/uuid-image.png"
                ),
            ]
        );
    }

    #[test]
    fn builds_image_only_turn_without_empty_text_item() {
        let prompt = "附图：@/tmp/only-missing-wise-test.png";
        let items =
            build_turn_input_items_from_composer_prompt_for_model(prompt, Some("gpt-5.4"));
        assert_eq!(
            items,
            vec![TurnInputItem::local_image("/tmp/only-missing-wise-test.png")]
        );
    }

    #[test]
    fn builds_data_url_image_item() {
        let prompt = "见图 data:image/png;base64,QUJD";
        let items =
            build_turn_input_items_from_composer_prompt_for_model(prompt, Some("gpt-5.4"));
        assert_eq!(
            items,
            vec![
                TurnInputItem::text("见图"),
                TurnInputItem::image_data_url("data:image/png;base64,QUJD"),
            ]
        );
    }

    #[test]
    fn inlines_existing_local_png_as_image_data_url() {
        let dir = std::env::temp_dir().join(format!(
            "wise-codex-img-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let file = dir.join("shot.png");
        // Minimal valid-ish PNG header bytes (Codex/app-server only needs a data URL here).
        let png_bytes: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
        std::fs::write(&file, png_bytes).expect("write png");
        let prompt = format!("图中有什么\n\n附图：@{}", file.display());
        let items =
            build_turn_input_items_from_composer_prompt_for_model(&prompt, Some("gpt-5.4"));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], TurnInputItem::text("图中有什么"));
        match &items[1] {
            TurnInputItem::Image { url, detail } => {
                assert!(url.starts_with("data:image/png;base64,"));
                assert_eq!(detail.as_deref(), Some("high"));
            }
            other => panic!("expected Image data URL, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
    
    #[test]
    fn parses_wire_method_aliases_for_existing_notifications() {
        // app-server 实际用斜杠风格 method；旧 camelCase 仍兼容。
        let status = parse_notification(
            "mcpServer/startupStatus/updated",
            Some(json!({ "name": "github", "status": "ready" })),
        );
        assert!(matches!(
            status,
            ServerNotification::McpServerStatusUpdated { name, status, .. }
                if name == "github" && status == "ready"
        ));

        let oauth = parse_notification(
            "mcpServer/oauthLogin/completed",
            Some(json!({ "name": "github", "success": true })),
        );
        assert!(matches!(
            oauth,
            ServerNotification::McpOAuthLoginCompleted { name, success, .. }
                if name == "github" && success
        ));

        let plan = parse_notification(
            "turn/plan/updated",
            Some(json!({ "threadId": "thr", "turnId": "t1", "plan": [{ "status": "in_progress", "step": "调研" }] })),
        );
        assert!(matches!(
            plan,
            ServerNotification::TurnPlanUpdated { plan: Some(v), .. } if v.is_array()
        ));

        let diff = parse_notification(
            "turn/diff/updated",
            Some(json!({ "threadId": "thr", "turnId": "t1", "diff": "@@ -1 +1 @@" })),
        );
        assert!(matches!(
            diff,
            ServerNotification::TurnDiffUpdated { diff: Some(d), .. } if d == "@@ -1 +1 @@"
        ));
    }

    #[test]
    fn parses_new_wire_notifications() {
        let reasoning = parse_notification(
            "item/reasoning/textDelta",
            Some(json!({ "itemId": "itm", "threadId": "thr", "turnId": "t1", "delta": "思考中" })),
        );
        assert!(matches!(
            reasoning,
            ServerNotification::ReasoningTextDelta { item_id, delta } if item_id == "itm" && delta == "思考中"
        ));

        let plan_delta = parse_notification(
            "item/plan/delta",
            Some(json!({ "itemId": "itm", "threadId": "thr", "turnId": "t1", "delta": "步骤一" })),
        );
        assert!(matches!(
            plan_delta,
            ServerNotification::PlanDelta { item_id, delta } if item_id == "itm" && delta == "步骤一"
        ));

        let process_out = parse_notification(
            "process/outputDelta",
            Some(json!({ "processHandle": "p1", "stream": "stdout", "deltaBase64": "aGk=", "capReached": false })),
        );
        assert!(matches!(
            process_out,
            ServerNotification::ProcessOutputDeltaNotification { process_id, delta_base64, .. }
                if process_id == "p1" && delta_base64 == "aGk="
        ));

        let process_exit = parse_notification(
            "process/exited",
            Some(json!({ "processHandle": "p1", "exitCode": 0, "stdout": "ok", "stderr": "" })),
        );
        assert!(matches!(
            process_exit,
            ServerNotification::ProcessExited { process_id, exit_code, stdout, .. }
                if process_id == "p1" && exit_code == 0 && stdout == "ok"
        ));

        let warning = parse_notification("warning", Some(json!({ "message": "磁盘空间不足" })));
        assert!(matches!(
            warning,
            ServerNotification::Warning { message, .. } if message == "磁盘空间不足"
        ));

        let guardian = parse_notification(
            "guardianWarning",
            Some(json!({ "threadId": "thr", "message": "注意隐私" })),
        );
        assert!(matches!(
            guardian,
            ServerNotification::Warning { message, thread_id: Some(t), .. }
                if message == "注意隐私" && t == "thr"
        ));

        let hook_started = parse_notification(
            "hook/started",
            Some(json!({
                "threadId": "thr",
                "turnId": "t1",
                "run": {
                    "id": "hook_1",
                    "eventName": "PreToolUse",
                    "status": "running",
                    "entries": [],
                },
            })),
        );
        assert!(matches!(
            hook_started,
            ServerNotification::HookStarted { thread_id, run }
                if thread_id == "thr"
                    && run.get("eventName").and_then(Value::as_str) == Some("PreToolUse")
        ));

        let hook_completed = parse_notification(
            "hook/completed",
            Some(json!({
                "threadId": "thr",
                "turnId": "t1",
                "run": {
                    "id": "hook_1",
                    "eventName": "PostToolUse",
                    "status": "failed",
                    "statusMessage": "hook timed out",
                    "entries": [
                        { "kind": "error", "text": "boom" },
                        { "kind": "context", "text": "cwd=/repo" },
                    ],
                },
            })),
        );
        assert!(matches!(
            hook_completed,
            ServerNotification::HookCompleted { thread_id, run }
                if thread_id == "thr"
                    && run.get("status").and_then(Value::as_str) == Some("failed")
        ));

        let config_warning = parse_notification(
            "configWarning",
            Some(json!({
                "summary": "未知配置项",
                "details": "请检查拼写",
                "path": "/Users/x/.codex/config.toml",
            })),
        );
        assert!(matches!(
            config_warning,
            ServerNotification::ConfigWarning { summary, details: Some(d), path: Some(p) }
                if summary == "未知配置项" && d == "请检查拼写" && p.ends_with("config.toml")
        ));

        let deprecation = parse_notification(
            "deprecationNotice",
            Some(json!({ "summary": "experimental_feature 已废弃" })),
        );
        assert!(matches!(
            deprecation,
            ServerNotification::DeprecationNotice { summary, details: None }
                if summary == "experimental_feature 已废弃"
        ));

        let thread_status = parse_notification(
            "thread/status/changed",
            Some(json!({
                "threadId": "thr",
                "status": { "Active": { "activeFlags": ["WaitingOnApproval"] } },
            })),
        );
        assert!(matches!(
            thread_status,
            ServerNotification::ThreadStatusChanged { thread_id, status }
                if thread_id == "thr" && status.get("Active").is_some()
        ));

        let thread_status_flat = parse_notification(
            "thread/status/changed",
            Some(json!({ "threadId": "thr", "status": "SystemError" })),
        );
        assert!(matches!(
            thread_status_flat,
            ServerNotification::ThreadStatusChanged { status, .. }
                if status.as_str() == Some("SystemError")
        ));

        let thread_name = parse_notification(
            "thread/name/updated",
            Some(json!({ "threadId": "thr", "threadName": "优化搜索速度" })),
        );
        assert!(matches!(
            thread_name,
            ServerNotification::ThreadNameUpdated { thread_id, thread_name: Some(n) }
                if thread_id == "thr" && n == "优化搜索速度"
        ));

        let thread_name_cleared = parse_notification(
            "thread/name/updated",
            Some(json!({ "threadId": "thr", "threadName": null })),
        );
        assert!(matches!(
            thread_name_cleared,
            ServerNotification::ThreadNameUpdated { thread_name: None, .. }
        ));

        let compacted = parse_notification(
            "thread/compacted",
            Some(json!({ "threadId": "thr" })),
        );
        assert!(matches!(
            compacted,
            ServerNotification::ThreadCompacted { thread_id } if thread_id == "thr"
        ));

        let patch = parse_notification(
            "item/fileChange/patchUpdated",
            Some(json!({ "itemId": "itm", "threadId": "thr", "turnId": "t1", "changes": [] })),
        );
        assert!(matches!(
            patch,
            ServerNotification::FileChangePatchUpdated { item_id, changes } if item_id == "itm" && changes.is_array()
        ));

        let review_started = parse_notification(
            "item/autoApprovalReview/started",
            Some(json!({
                "reviewId": "rev_1",
                "threadId": "thr",
                "turnId": "t1",
                "targetItemId": "itm_cmd",
                "action": { "type": "command", "command": "npm test", "cwd": "/repo", "source": "unifiedExec" },
                "review": { "status": "inProgress", "riskLevel": "low", "rationale": null },
            })),
        );
        assert!(matches!(
            review_started,
            ServerNotification::AutoApprovalReviewStarted {
                review_id,
                target_item_id: Some(tid),
                ..
            } if review_id == "rev_1" && tid == "itm_cmd"
        ));

        let review_completed = parse_notification(
            "item/autoApprovalReview/completed",
            Some(json!({
                "reviewId": "rev_1",
                "threadId": "thr",
                "turnId": "t1",
                "targetItemId": null,
                "decisionSource": "agent",
                "action": { "type": "command", "command": "npm test", "cwd": "/repo", "source": "unifiedExec" },
                "review": { "status": "approved", "riskLevel": "low", "rationale": "测试命令" },
            })),
        );
        assert!(matches!(
            review_completed,
            ServerNotification::AutoApprovalReviewCompleted {
                review_id,
                decision_source: Some(src),
                review,
                ..
            } if review_id == "rev_1" && src == "agent" && review["status"] == "approved"
        ));

        let usage = parse_notification(
            "turn/tokenUsage/updated",
            Some(json!({
                "threadId": "thr",
                "turnId": "t1",
                "tokenUsage": {
                    "total": { "inputTokens": 100, "outputTokens": 50, "totalTokens": 150 },
                    "last": { "inputTokens": 10, "outputTokens": 5, "totalTokens": 15 },
                },
            })),
        );
        assert!(matches!(
            usage,
            ServerNotification::ThreadTokenUsageUpdated {
                thread_id,
                turn_id,
                token_usage,
            } if thread_id == "thr" && turn_id == "t1" && token_usage["total"]["totalTokens"] == 150
        ));

        let rerouted = parse_notification(
            "model/rerouted",
            Some(json!({
                "threadId": "thr",
                "turnId": "t1",
                "fromModel": "gpt-5.4",
                "toModel": "gpt-5.4-mini",
                "reason": "highRiskCyberActivity",
            })),
        );
        assert!(matches!(
            rerouted,
            ServerNotification::ModelRerouted {
                from_model,
                to_model,
                reason: Some(r),
                ..
            } if from_model == "gpt-5.4" && to_model == "gpt-5.4-mini" && r == "highRiskCyberActivity"
        ));
    }
}
