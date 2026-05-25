use crate::{claude_config_dir, wise_db};
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const TRELLIS_RUNTIME_EVENT: &str = "trellis-runtime-event";
const MISSION_UPDATED_EVENT: &str = "mission-updated";
const ASSIGNMENT_CHANGED_EVENT: &str = "mission-agent-assignment-changed";
const DEFAULT_TAIL_LINES: usize = 1_600;
const DEFAULT_MAX_SESSIONS: usize = 16;
const DEFAULT_STALE_AFTER_MS: i64 = 5 * 60 * 1000;
const MAX_TEXT_EXCERPT_CHARS: usize = 1_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeExternalIngestInput {
    project_id: Option<String>,
    root_path: String,
    mission_id: Option<String>,
    session_ids: Option<Vec<String>>,
    tail_lines: Option<usize>,
    max_sessions: Option<usize>,
    stale_after_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeExternalSessionIngestSummary {
    session_id: String,
    updated_at: i64,
    line_count: usize,
    hook_event_count: usize,
    agent_run_count: usize,
    runtime_event_count: usize,
    assignment_count: usize,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeExternalIngestResult {
    project_id: Option<String>,
    root_path: String,
    mission_id: Option<String>,
    scanned_session_count: usize,
    runtime_event_count: usize,
    agent_run_count: usize,
    assignment_count: usize,
    sessions: Vec<ClaudeExternalSessionIngestSummary>,
}

#[derive(Debug, Clone)]
struct SessionFile {
    session_id: String,
    path: PathBuf,
    updated_at: i64,
}

#[derive(Debug, Clone)]
struct ParsedClaudeSession {
    session_id: String,
    cwd: Option<String>,
    model: Option<String>,
    started_at: i64,
    updated_at: i64,
    line_count: usize,
    hooks: Vec<ParsedHookEvent>,
    agents: Vec<ParsedAgentInvocation>,
}

#[derive(Debug, Clone)]
struct ParsedHookEvent {
    hook_event: String,
    hook_name: Option<String>,
    status: String,
    timestamp: i64,
    line_no: usize,
    detail: Value,
}

#[derive(Debug, Clone)]
struct ParsedAgentInvocation {
    tool_use_id: String,
    tool_name: String,
    agent_type: String,
    stage: String,
    description: Option<String>,
    prompt_excerpt: Option<String>,
    output_excerpt: Option<String>,
    parent_uuid: Option<String>,
    started_at: i64,
    updated_at: i64,
    completed_at: Option<i64>,
    status: String,
    line_no: usize,
    task_path: Option<String>,
    task_id: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingAgentInvocation {
    tool_use_id: String,
    tool_name: String,
    agent_type: String,
    stage: String,
    description: Option<String>,
    prompt_excerpt: Option<String>,
    parent_uuid: Option<String>,
    started_at: i64,
    updated_at: i64,
    line_no: usize,
}

#[tauri::command]
pub(crate) fn ingest_external_claude_cli_sessions(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: ClaudeExternalIngestInput,
) -> Result<ClaudeExternalIngestResult, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let project_id = normalize_optional(input.project_id);
    let mission_id = normalize_optional(input.mission_id);
    if let Some(mid) = mission_id.as_deref() {
        ensure_mission_exists(&db, mid)?;
    }

    let tail_lines = input.tail_lines.unwrap_or(DEFAULT_TAIL_LINES).clamp(1, 20_000);
    let max_sessions = input
        .max_sessions
        .unwrap_or(DEFAULT_MAX_SESSIONS)
        .clamp(1, 200);
    let stale_after_ms = input.stale_after_ms.unwrap_or(DEFAULT_STALE_AFTER_MS).max(30_000);
    let session_filter = input.session_ids.map(|items| {
        items
            .into_iter()
            .filter_map(|item| normalize_optional(Some(item)))
            .collect::<Vec<_>>()
    });

    let files = discover_session_files(&root, session_filter.as_deref(), max_sessions)?;
    let mut summaries = Vec::new();
    let mut total_events = 0usize;
    let mut total_agents = 0usize;
    let mut total_assignments = 0usize;

    for file in files {
        let lines = read_tail_lines(&file.path, tail_lines)?;
        let parsed = parse_claude_session_lines(&file.session_id, &lines, file.updated_at);
        let session_status = infer_session_status(parsed.updated_at, stale_after_ms);
        let mut session_events = 0usize;
        let mut session_assignments = 0usize;

        if upsert_session_observed(
            &app,
            &db,
            &project_id,
            &root,
            mission_id.as_deref(),
            &parsed,
            &session_status,
        )? {
            session_events += 1;
        }
        upsert_main_session_agent_run(
            &app,
            &db,
            &project_id,
            &root,
            &parsed,
            &session_status,
        )?;
        total_agents += 1;

        for hook in &parsed.hooks {
            if insert_hook_event(&app, &db, &project_id, &root, &parsed, hook)? {
                session_events += 1;
            }
            if let Some(mid) = mission_id.as_deref() {
                insert_mission_event_if_missing(
                    &app,
                    &db,
                    mid,
                    &format!(
                        "external_mission_hook_{}",
                        stable_hash(&format!("{}:{}:{}", parsed.session_id, hook.line_no, hook.hook_event))
                    ),
                    "mission.externalClaude.hook",
                    hook.timestamp,
                    Some("claude-cli".to_string()),
                    json!({
                        "sessionId": parsed.session_id,
                        "hookEvent": hook.hook_event,
                        "hookName": hook.hook_name,
                        "status": hook.status,
                        "rootPath": root.to_string_lossy(),
                        "source": "external-claude-cli",
                    }),
                )?;
            }
        }

        for agent in &parsed.agents {
            let status = normalize_agent_status(agent, parsed.updated_at, stale_after_ms);
            let agent_run_id = external_agent_run_id(&parsed.session_id, &agent.tool_use_id);
            upsert_agent_run(
                &app,
                &db,
                &project_id,
                &root,
                &parsed,
                agent,
                &agent_run_id,
                &status,
            )?;
            total_agents += 1;

            if insert_agent_runtime_event(
                &app,
                &db,
                &project_id,
                &root,
                &parsed,
                agent,
                &agent_run_id,
                "dispatched",
                agent.started_at,
            )? {
                session_events += 1;
            }
            if matches!(status.as_str(), "succeeded" | "failed" | "stale") {
                let timestamp = agent.completed_at.unwrap_or(parsed.updated_at);
                if insert_agent_runtime_event(
                    &app,
                    &db,
                    &project_id,
                    &root,
                    &parsed,
                    agent,
                    &agent_run_id,
                    &status,
                    timestamp,
                )? {
                    session_events += 1;
                }
            }

            if let Some(mid) = mission_id.as_deref() {
                upsert_session_binding(
                    &app,
                    &db,
                    mid,
                    &parsed.session_id,
                    project_id.as_deref(),
                    &root,
                )?;
                if upsert_mission_assignment(
                    &app,
                    &db,
                    mid,
                    &project_id,
                    &root,
                    &parsed,
                    agent,
                    &agent_run_id,
                    &status,
                )? {
                    session_assignments += 1;
                }
                insert_mission_event_if_missing(
                    &app,
                    &db,
                    mid,
                    &format!(
                        "external_mission_agent_{}_{}",
                        stable_hash(&format!("{}:{}", parsed.session_id, agent.tool_use_id)),
                        status
                    ),
                    "mission.externalClaude.agent",
                    agent.updated_at,
                    Some(agent.agent_type.clone()),
                    json!({
                        "agentRunId": agent_run_id,
                        "sessionId": parsed.session_id,
                        "agentType": agent.agent_type,
                        "stage": agent.stage,
                        "status": status,
                        "taskPath": agent.task_path,
                        "taskId": agent.task_id,
                        "repositoryPath": parsed.cwd.clone().unwrap_or_else(|| root.to_string_lossy().to_string()),
                        "description": agent.description,
                        "source": "external-claude-cli",
                    }),
                )?;
            }
        }

        total_events += session_events;
        total_assignments += session_assignments;
        summaries.push(ClaudeExternalSessionIngestSummary {
            session_id: parsed.session_id,
            updated_at: parsed.updated_at,
            line_count: parsed.line_count,
            hook_event_count: parsed.hooks.len(),
            agent_run_count: parsed.agents.len(),
            runtime_event_count: session_events,
            assignment_count: session_assignments,
            status: session_status,
        });
    }

    Ok(ClaudeExternalIngestResult {
        project_id,
        root_path: root.to_string_lossy().to_string(),
        mission_id,
        scanned_session_count: summaries.len(),
        runtime_event_count: total_events,
        agent_run_count: total_agents,
        assignment_count: total_assignments,
        sessions: summaries,
    })
}

fn discover_session_files(
    root: &Path,
    session_filter: Option<&[String]>,
    max_sessions: usize,
) -> Result<Vec<SessionFile>, String> {
    let dir = claude_config_dir::user_claude_dir()
        .join("projects")
        .join(encoded_claude_project_dir(root)?);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(session_id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string)
        else {
            continue;
        };
        if !is_safe_claude_session_filename(&session_id) {
            continue;
        }
        if let Some(filter) = session_filter {
            if !filter.iter().any(|id| id == &session_id) {
                continue;
            }
        }
        let updated_at = fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(system_time_ms)
            .unwrap_or(0);
        out.push(SessionFile {
            session_id,
            path,
            updated_at,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out.truncate(max_sessions);
    Ok(out)
}

fn parse_claude_session_lines(
    fallback_session_id: &str,
    lines: &[String],
    fallback_updated_at: i64,
) -> ParsedClaudeSession {
    let mut session_id = fallback_session_id.to_string();
    let mut cwd = None;
    let mut model = None;
    let mut started_at = i64::MAX;
    let mut updated_at = fallback_updated_at;
    let mut hooks = Vec::new();
    let mut pending = BTreeMap::<String, PendingAgentInvocation>::new();
    let mut completed = Vec::<ParsedAgentInvocation>::new();

    for (idx, line) in lines.iter().enumerate() {
        let line_no = idx + 1;
        let Ok(row) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if let Some(sid) = string_field(&row, "sessionId") {
            session_id = sid;
        }
        if cwd.is_none() {
            cwd = string_field(&row, "cwd");
        }
        if model.is_none() {
            model = row
                .pointer("/message/model")
                .and_then(Value::as_str)
                .or_else(|| row.get("model").and_then(Value::as_str))
                .map(str::to_string);
        }
        let timestamp = parse_timestamp_ms(row.get("timestamp")).unwrap_or(fallback_updated_at);
        started_at = started_at.min(timestamp);
        updated_at = updated_at.max(timestamp);

        if let Some(hook) = parse_hook_event(&row, line_no, timestamp) {
            hooks.push(hook);
        }

        if row.get("type").and_then(Value::as_str) == Some("assistant") {
            for block in content_blocks(&row) {
                if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                    continue;
                }
                let Some(tool_name) = string_field(block, "name") else {
                    continue;
                };
                if !is_subagent_tool_name(&tool_name) {
                    continue;
                }
                let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                let tool_use_id = string_field(block, "id")
                    .unwrap_or_else(|| format!("line-{line_no}-{tool_name}"));
                let agent_type = string_field(&input, "subagent_type")
                    .or_else(|| string_field(&input, "agent_type"))
                    .or_else(|| string_field(&input, "agent"))
                    .unwrap_or_else(|| tool_name.clone());
                let description = string_field(&input, "description")
                    .or_else(|| string_field(&input, "title"));
                let prompt_excerpt = string_field(&input, "prompt").map(|s| excerpt(&s));
                pending.insert(
                    tool_use_id.clone(),
                    PendingAgentInvocation {
                        tool_use_id,
                        tool_name,
                        stage: stage_from_agent_type(&agent_type),
                        agent_type,
                        description,
                        prompt_excerpt,
                        parent_uuid: string_field(&row, "parentUuid"),
                        started_at: timestamp,
                        updated_at: timestamp,
                        line_no,
                    },
                );
            }
        }

        if row.get("type").and_then(Value::as_str) == Some("user") {
            for block in content_blocks(&row) {
                if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                    continue;
                }
                let Some(tool_use_id) = string_field(block, "tool_use_id")
                    .or_else(|| string_field(block, "toolUseId"))
                else {
                    continue;
                };
                let Some(start) = pending.remove(&tool_use_id) else {
                    continue;
                };
                let raw_output = tool_result_text(block);
                let combined_text = [
                    start.description.as_deref(),
                    start.prompt_excerpt.as_deref(),
                    raw_output.as_deref(),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("\n");
                let task_path = extract_task_path(&combined_text);
                let status = if block.get("is_error").and_then(Value::as_bool) == Some(true) {
                    "failed"
                } else {
                    "succeeded"
                }
                .to_string();
                completed.push(ParsedAgentInvocation {
                    tool_use_id: start.tool_use_id,
                    tool_name: start.tool_name,
                    agent_type: start.agent_type,
                    stage: start.stage,
                    description: start.description,
                    prompt_excerpt: start.prompt_excerpt,
                    output_excerpt: raw_output.map(|s| excerpt(&s)),
                    parent_uuid: start.parent_uuid,
                    started_at: start.started_at,
                    updated_at: timestamp,
                    completed_at: Some(timestamp),
                    status,
                    line_no: start.line_no,
                    task_id: task_path.as_deref().and_then(task_id_from_path),
                    task_path,
                });
            }
        }
    }

    let mut agents = completed;
    for start in pending.into_values() {
        let combined_text = [start.description.as_deref(), start.prompt_excerpt.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n");
        let task_path = extract_task_path(&combined_text);
        agents.push(ParsedAgentInvocation {
            tool_use_id: start.tool_use_id,
            tool_name: start.tool_name,
            agent_type: start.agent_type,
            stage: start.stage,
            description: start.description,
            prompt_excerpt: start.prompt_excerpt,
            output_excerpt: None,
            parent_uuid: start.parent_uuid,
            started_at: start.started_at,
            updated_at: updated_at.max(start.updated_at),
            completed_at: None,
            status: "running".to_string(),
            line_no: start.line_no,
            task_id: task_path.as_deref().and_then(task_id_from_path),
            task_path,
        });
    }
    agents.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.tool_use_id.cmp(&b.tool_use_id)));

    ParsedClaudeSession {
        session_id,
        cwd,
        model,
        started_at: if started_at == i64::MAX {
            fallback_updated_at
        } else {
            started_at
        },
        updated_at,
        line_count: lines.len(),
        hooks,
        agents,
    }
}

fn parse_hook_event(row: &Value, line_no: usize, timestamp: i64) -> Option<ParsedHookEvent> {
    if let Some(attachment) = row.get("attachment").and_then(Value::as_object) {
        let attachment_type = attachment.get("type").and_then(Value::as_str).unwrap_or("");
        if matches!(
            attachment_type,
            "hook_success" | "hook_error" | "hook_additional_context"
        ) {
            let hook_event = attachment
                .get("hookEvent")
                .and_then(Value::as_str)
                .or_else(|| attachment.get("hook_event").and_then(Value::as_str))
                .or_else(|| attachment.get("hookName").and_then(Value::as_str))
                .unwrap_or("Hook")
                .to_string();
            let status = if attachment_type == "hook_error" {
                "failed"
            } else {
                "succeeded"
            }
            .to_string();
            return Some(ParsedHookEvent {
                hook_event,
                hook_name: attachment.get("hookName").and_then(Value::as_str).map(str::to_string),
                status,
                timestamp,
                line_no,
                detail: sanitize_hook_detail(&Value::Object(attachment.clone())),
            });
        }
    }

    if row.get("type").and_then(Value::as_str) == Some("system")
        && row.get("subtype").and_then(Value::as_str) == Some("hook_response")
    {
        let hook_event = string_field(row, "hook_event")
            .or_else(|| string_field(row, "hookEvent"))
            .unwrap_or_else(|| "Hook".to_string());
        let status = string_field(row, "status")
            .or_else(|| string_field(row, "outcome"))
            .unwrap_or_else(|| "succeeded".to_string());
        return Some(ParsedHookEvent {
            hook_event,
            hook_name: None,
            status,
            timestamp,
            line_no,
            detail: sanitize_hook_detail(row),
        });
    }
    None
}

fn upsert_session_observed(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    project_id: &Option<String>,
    root: &Path,
    mission_id: Option<&str>,
    session: &ParsedClaudeSession,
    status: &str,
) -> Result<bool, String> {
    let event_id = format!("external_claude_session_{}", stable_hash(&session.session_id));
    let inserted = insert_runtime_event_if_missing(
        app,
        db,
        RuntimeEventInsert {
            event_id,
            project_id: project_id.clone(),
            root_path: root.to_string_lossy().to_string(),
            session_id: Some(session.session_id.clone()),
            task_path: None,
            task_id: None,
            event_kind: "trellis.externalClaude.session.observed".to_string(),
            platform: Some("claude".to_string()),
            actor: Some("claude-cli".to_string()),
            correlation_id: Some(session.session_id.clone()),
            parent_event_id: None,
            payload: json!({
                "sessionId": session.session_id,
                "cwd": session.cwd,
                "model": session.model,
                "status": status,
                "lineCount": session.line_count,
                "source": "external-claude-cli",
            }),
            created_at: session.started_at,
        },
    )?;
    if let Some(mid) = mission_id {
        upsert_session_binding(app, db, mid, &session.session_id, project_id.as_deref(), root)?;
        insert_mission_event_if_missing(
            app,
            db,
            mid,
            &format!("external_mission_session_{}", stable_hash(&session.session_id)),
            "mission.externalClaude.sessionObserved",
            session.started_at,
            Some("claude-cli".to_string()),
            json!({
                "sessionId": session.session_id,
                "rootPath": root.to_string_lossy(),
                "repositoryPath": session.cwd.clone().unwrap_or_else(|| root.to_string_lossy().to_string()),
                "status": status,
                "source": "external-claude-cli",
            }),
        )?;
    }
    Ok(inserted)
}

fn insert_hook_event(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    project_id: &Option<String>,
    root: &Path,
    session: &ParsedClaudeSession,
    hook: &ParsedHookEvent,
) -> Result<bool, String> {
    insert_runtime_event_if_missing(
        app,
        db,
        RuntimeEventInsert {
            event_id: format!(
                "external_claude_hook_{}",
                stable_hash(&format!("{}:{}:{}", session.session_id, hook.line_no, hook.hook_event))
            ),
            project_id: project_id.clone(),
            root_path: root.to_string_lossy().to_string(),
            session_id: Some(session.session_id.clone()),
            task_path: None,
            task_id: None,
            event_kind: "trellis.externalClaude.hook".to_string(),
            platform: Some("claude".to_string()),
            actor: Some("claude-cli".to_string()),
            correlation_id: Some(session.session_id.clone()),
            parent_event_id: None,
            payload: json!({
                "sessionId": session.session_id,
                "hookEvent": hook.hook_event,
                "hookName": hook.hook_name,
                "status": hook.status,
                "detail": hook.detail,
                "source": "external-claude-cli",
            }),
            created_at: hook.timestamp,
        },
    )
}

fn upsert_agent_run(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    project_id: &Option<String>,
    root: &Path,
    session: &ParsedClaudeSession,
    agent: &ParsedAgentInvocation,
    agent_run_id: &str,
    status: &str,
) -> Result<(), String> {
    let now = unix_now_ms();
    let updated_at = agent.completed_at.unwrap_or(now.max(agent.updated_at));
    let repository_path = session
        .cwd
        .clone()
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    let metadata = json!({
        "source": "external-claude-cli",
        "toolUseId": agent.tool_use_id,
        "toolName": agent.tool_name,
        "description": agent.description,
        "promptExcerpt": agent.prompt_excerpt,
        "outputExcerpt": agent.output_excerpt,
        "parentUuid": agent.parent_uuid,
        "lineNo": agent.line_no,
        "sessionUpdatedAt": session.updated_at,
        "model": session.model,
    });
    let metadata_json =
        serde_json::to_string(&metadata).map_err(|e| format!("序列化 agent metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_agent_runs (
               agent_run_id, project_id, root_path, session_id, task_path, task_id, repository_id,
               repository_path, agent_type, stage, status, current_file, started_at, updated_at,
               completed_at, last_heartbeat_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?13, ?12, ?14)
             ON CONFLICT(agent_run_id) DO UPDATE SET
               project_id = excluded.project_id,
               root_path = excluded.root_path,
               session_id = excluded.session_id,
               task_path = excluded.task_path,
               task_id = excluded.task_id,
               repository_path = excluded.repository_path,
               agent_type = excluded.agent_type,
               stage = excluded.stage,
               status = excluded.status,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at,
               last_heartbeat_at = excluded.last_heartbeat_at,
               metadata_json = excluded.metadata_json",
            params![
                agent_run_id,
                project_id.as_deref(),
                root.to_string_lossy(),
                session.session_id,
                agent.task_path.as_deref(),
                agent.task_id.as_deref(),
                repository_path,
                agent.agent_type,
                agent.stage,
                status,
                agent.started_at,
                updated_at,
                terminal_completed_at(status, updated_at),
                metadata_json,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(row) = read_agent_run_json(db, agent_run_id)? {
        let event = json!({
            "eventId": format!("trellis_agent_upsert_emit_{}", stable_hash(agent_run_id)),
            "projectId": project_id,
            "rootPath": root.to_string_lossy(),
            "sessionId": session.session_id,
            "taskPath": agent.task_path,
            "taskId": agent.task_id,
            "eventKind": "trellis.agent.upserted",
            "platform": "claude",
            "actor": agent.agent_type,
            "correlationId": agent_run_id,
            "parentEventId": Value::Null,
            "payload": { "agentRun": row },
            "createdAt": updated_at,
        });
        let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    }
    Ok(())
}

fn upsert_main_session_agent_run(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    project_id: &Option<String>,
    root: &Path,
    session: &ParsedClaudeSession,
    status: &str,
) -> Result<(), String> {
    let agent_run_id = external_session_agent_run_id(&session.session_id);
    let repository_path = session
        .cwd
        .clone()
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    let metadata = json!({
        "source": "external-claude-cli",
        "kind": "main-session",
        "description": "Claude CLI main session",
        "lineCount": session.line_count,
        "sessionUpdatedAt": session.updated_at,
        "model": session.model,
    });
    let metadata_json =
        serde_json::to_string(&metadata).map_err(|e| format!("序列化 main session metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_agent_runs (
               agent_run_id, project_id, root_path, session_id, task_path, task_id, repository_id,
               repository_path, agent_type, stage, status, current_file, started_at, updated_at,
               completed_at, last_heartbeat_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, 'claude-cli', 'main-session', ?6, NULL, ?7, ?8, ?9, ?8, ?10)
             ON CONFLICT(agent_run_id) DO UPDATE SET
               project_id = excluded.project_id,
               root_path = excluded.root_path,
               session_id = excluded.session_id,
               repository_path = excluded.repository_path,
               status = excluded.status,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at,
               last_heartbeat_at = excluded.last_heartbeat_at,
               metadata_json = excluded.metadata_json",
            params![
                agent_run_id,
                project_id.as_deref(),
                root.to_string_lossy(),
                session.session_id,
                repository_path,
                status,
                session.started_at,
                session.updated_at,
                terminal_completed_at(status, session.updated_at),
                metadata_json,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(row) = read_agent_run_json(db, &agent_run_id)? {
        let event = json!({
            "eventId": format!("trellis_agent_upsert_emit_{}", stable_hash(&agent_run_id)),
            "projectId": project_id,
            "rootPath": root.to_string_lossy(),
            "sessionId": session.session_id,
            "taskPath": Value::Null,
            "taskId": Value::Null,
            "eventKind": "trellis.agent.upserted",
            "platform": "claude",
            "actor": "claude-cli",
            "correlationId": agent_run_id,
            "parentEventId": Value::Null,
            "payload": { "agentRun": row },
            "createdAt": session.updated_at,
        });
        let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    }
    Ok(())
}

fn insert_agent_runtime_event(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    project_id: &Option<String>,
    root: &Path,
    session: &ParsedClaudeSession,
    agent: &ParsedAgentInvocation,
    agent_run_id: &str,
    lifecycle: &str,
    timestamp: i64,
) -> Result<bool, String> {
    insert_runtime_event_if_missing(
        app,
        db,
        RuntimeEventInsert {
            event_id: format!(
                "external_claude_agent_{}_{}",
                stable_hash(&format!("{}:{}", session.session_id, agent.tool_use_id)),
                lifecycle
            ),
            project_id: project_id.clone(),
            root_path: root.to_string_lossy().to_string(),
            session_id: Some(session.session_id.clone()),
            task_path: agent.task_path.clone(),
            task_id: agent.task_id.clone(),
            event_kind: format!("trellis.externalClaude.agent.{lifecycle}"),
            platform: Some("claude".to_string()),
            actor: Some(agent.agent_type.clone()),
            correlation_id: Some(agent_run_id.to_string()),
            parent_event_id: None,
            payload: json!({
                "agentRunId": agent_run_id,
                "sessionId": session.session_id,
                "toolUseId": agent.tool_use_id,
                "toolName": agent.tool_name,
                "agentType": agent.agent_type,
                "stage": agent.stage,
                "description": agent.description,
                "status": lifecycle,
                "taskPath": agent.task_path,
                "taskId": agent.task_id,
                "source": "external-claude-cli",
            }),
            created_at: timestamp,
        },
    )
}

fn upsert_session_binding(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    mission_id: &str,
    session_id: &str,
    project_id: Option<&str>,
    root: &Path,
) -> Result<(), String> {
    let now = unix_now_ms();
    let metadata = json!({
        "source": "external-claude-cli",
        "rootPath": root.to_string_lossy(),
    });
    let metadata_json =
        serde_json::to_string(&metadata).map_err(|e| format!("序列化 session metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO mission_session_bindings (
               session_id, mission_id, project_id, attached_at, updated_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)
             ON CONFLICT(session_id) DO UPDATE SET
               mission_id = excluded.mission_id,
               project_id = excluded.project_id,
               updated_at = excluded.updated_at,
               metadata_json = excluded.metadata_json",
            params![session_id, mission_id, project_id, now, metadata_json],
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        MISSION_UPDATED_EVENT,
        json!({
            "missionId": mission_id,
            "sessionId": session_id,
            "source": "external-claude-cli",
        }),
    );
    Ok(())
}

fn upsert_mission_assignment(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    mission_id: &str,
    project_id: &Option<String>,
    root: &Path,
    session: &ParsedClaudeSession,
    agent: &ParsedAgentInvocation,
    agent_run_id: &str,
    status: &str,
) -> Result<bool, String> {
    let assignment_id = format!(
        "external_assignment_{}",
        stable_hash(&format!("{mission_id}:{agent_run_id}"))
    );
    let repository_path = session
        .cwd
        .clone()
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    let updated_at = agent.completed_at.unwrap_or_else(unix_now_ms).max(agent.updated_at);
    let metadata = json!({
        "source": "external-claude-cli",
        "toolUseId": agent.tool_use_id,
        "description": agent.description,
        "promptExcerpt": agent.prompt_excerpt,
        "outputExcerpt": agent.output_excerpt,
        "lineNo": agent.line_no,
    });
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("序列化 assignment metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO mission_agent_assignments (
               assignment_id, mission_id, agent_run_id, project_id, task_id, cluster_id, repository_id,
               repository_path, agent_type, employee_id, stage, status, current_file, session_id,
               started_at, updated_at, completed_at, last_heartbeat_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, NULL, ?8, ?9, NULL, ?10, ?11, ?12, ?13, ?12, ?14)
             ON CONFLICT(agent_run_id) DO UPDATE SET
               mission_id = excluded.mission_id,
               project_id = excluded.project_id,
               task_id = excluded.task_id,
               repository_path = excluded.repository_path,
               agent_type = excluded.agent_type,
               stage = excluded.stage,
               status = excluded.status,
               session_id = excluded.session_id,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at,
               last_heartbeat_at = excluded.last_heartbeat_at,
               metadata_json = excluded.metadata_json",
            params![
                assignment_id,
                mission_id,
                agent_run_id,
                project_id.as_deref(),
                agent.task_id.as_deref(),
                repository_path,
                agent.agent_type,
                agent.stage,
                status,
                session.session_id,
                agent.started_at,
                updated_at,
                terminal_completed_at(status, updated_at),
                metadata_json,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(row) = read_assignment_json(db, agent_run_id)? {
        let _ = app.emit(ASSIGNMENT_CHANGED_EVENT, &row);
    }
    Ok(true)
}

struct RuntimeEventInsert {
    event_id: String,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    task_id: Option<String>,
    event_kind: String,
    platform: Option<String>,
    actor: Option<String>,
    correlation_id: Option<String>,
    parent_event_id: Option<String>,
    payload: Value,
    created_at: i64,
}

fn insert_runtime_event_if_missing(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    input: RuntimeEventInsert,
) -> Result<bool, String> {
    let payload_json =
        serde_json::to_string(&input.payload).map_err(|e| format!("序列化 runtime event 失败: {e}"))?;
    let changed = {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT OR IGNORE INTO trellis_runtime_events (
               event_id, project_id, root_path, session_id, task_path, task_id, event_kind,
               platform, actor, correlation_id, parent_event_id, payload_json, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                input.event_id,
                input.project_id.as_deref(),
                input.root_path,
                input.session_id.as_deref(),
                input.task_path.as_deref(),
                input.task_id.as_deref(),
                input.event_kind,
                input.platform.as_deref(),
                input.actor.as_deref(),
                input.correlation_id.as_deref(),
                input.parent_event_id.as_deref(),
                payload_json,
                input.created_at,
            ],
        )
        .map_err(|e| e.to_string())?
    };
    if changed > 0 {
        let row = json!({
            "eventId": input.event_id,
            "projectId": input.project_id,
            "rootPath": input.root_path,
            "sessionId": input.session_id,
            "taskPath": input.task_path,
            "taskId": input.task_id,
            "eventKind": input.event_kind,
            "platform": input.platform,
            "actor": input.actor,
            "correlationId": input.correlation_id,
            "parentEventId": input.parent_event_id,
            "payload": input.payload,
            "createdAt": input.created_at,
        });
        let _ = app.emit(TRELLIS_RUNTIME_EVENT, &row);
    }
    Ok(changed > 0)
}

fn insert_mission_event_if_missing(
    app: &tauri::AppHandle,
    db: &wise_db::WiseDb,
    mission_id: &str,
    event_id: &str,
    event_type: &str,
    timestamp: i64,
    actor: Option<String>,
    payload: Value,
) -> Result<bool, String> {
    let payload_json =
        serde_json::to_string(&payload).map_err(|e| format!("序列化 mission event 失败: {e}"))?;
    let changed = {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT OR IGNORE INTO mission_events (
               event_id, mission_id, event_type, timestamp, actor, payload_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![event_id, mission_id, event_type, timestamp, actor, payload_json],
        )
        .map_err(|e| e.to_string())?
    };
    if changed > 0 {
        let _ = app.emit(
            MISSION_UPDATED_EVENT,
            json!({
                "eventId": event_id,
                "missionId": mission_id,
                "eventType": event_type,
                "timestamp": timestamp,
                "actor": actor,
                "payload": payload,
            }),
        );
    }
    Ok(changed > 0)
}

fn read_agent_run_json(db: &wise_db::WiseDb, agent_run_id: &str) -> Result<Option<Value>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT agent_run_id, project_id, root_path, session_id, task_path, task_id,
                repository_id, repository_path, agent_type, stage, status, current_file,
                started_at, updated_at, completed_at, last_heartbeat_at, metadata_json
         FROM trellis_agent_runs WHERE agent_run_id = ?1",
        params![agent_run_id],
        |row| {
            let metadata_raw: String = row.get(16)?;
            let metadata = serde_json::from_str::<Value>(&metadata_raw).unwrap_or_else(|_| json!({}));
            Ok(json!({
                "agentRunId": row.get::<_, String>(0)?,
                "projectId": row.get::<_, Option<String>>(1)?,
                "rootPath": row.get::<_, String>(2)?,
                "sessionId": row.get::<_, Option<String>>(3)?,
                "taskPath": row.get::<_, Option<String>>(4)?,
                "taskId": row.get::<_, Option<String>>(5)?,
                "repositoryId": row.get::<_, Option<i64>>(6)?,
                "repositoryPath": row.get::<_, Option<String>>(7)?,
                "agentType": row.get::<_, String>(8)?,
                "stage": row.get::<_, Option<String>>(9)?,
                "status": row.get::<_, String>(10)?,
                "currentFile": row.get::<_, Option<String>>(11)?,
                "startedAt": row.get::<_, i64>(12)?,
                "updatedAt": row.get::<_, i64>(13)?,
                "completedAt": row.get::<_, Option<i64>>(14)?,
                "lastHeartbeatAt": row.get::<_, i64>(15)?,
                "metadata": metadata,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn read_assignment_json(db: &wise_db::WiseDb, agent_run_id: &str) -> Result<Option<Value>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT assignment_id, mission_id, agent_run_id, project_id, task_id, cluster_id,
                repository_id, repository_path, agent_type, employee_id, stage, status,
                current_file, session_id, started_at, updated_at, completed_at,
                last_heartbeat_at, metadata_json
         FROM mission_agent_assignments WHERE agent_run_id = ?1",
        params![agent_run_id],
        |row| {
            let metadata_raw: String = row.get(18)?;
            let metadata = serde_json::from_str::<Value>(&metadata_raw).unwrap_or_else(|_| json!({}));
            Ok(json!({
                "assignmentId": row.get::<_, String>(0)?,
                "missionId": row.get::<_, String>(1)?,
                "agentRunId": row.get::<_, Option<String>>(2)?,
                "projectId": row.get::<_, Option<String>>(3)?,
                "taskId": row.get::<_, Option<String>>(4)?,
                "clusterId": row.get::<_, Option<String>>(5)?,
                "repositoryId": row.get::<_, Option<i64>>(6)?,
                "repositoryPath": row.get::<_, Option<String>>(7)?,
                "agentType": row.get::<_, String>(8)?,
                "employeeId": row.get::<_, Option<String>>(9)?,
                "stage": row.get::<_, String>(10)?,
                "status": row.get::<_, String>(11)?,
                "currentFile": row.get::<_, Option<String>>(12)?,
                "sessionId": row.get::<_, Option<String>>(13)?,
                "startedAt": row.get::<_, i64>(14)?,
                "updatedAt": row.get::<_, i64>(15)?,
                "completedAt": row.get::<_, Option<i64>>(16)?,
                "lastHeartbeatAt": row.get::<_, i64>(17)?,
                "metadata": metadata,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn ensure_mission_exists(db: &wise_db::WiseDb, mission_id: &str) -> Result<(), String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let count: i64 = g
        .query_row(
            "SELECT COUNT(*) FROM mission_runs WHERE mission_id = ?1",
            params![mission_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Err("Mission 未找到".to_string());
    }
    Ok(())
}

fn read_tail_lines(path: &Path, max_lines: usize) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let mut dq = VecDeque::with_capacity(max_lines.min(8_192));
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if dq.len() == max_lines {
            dq.pop_front();
        }
        dq.push_back(line);
    }
    Ok(dq.into_iter().collect())
}

fn content_blocks(row: &Value) -> &[Value] {
    row.pointer("/message/content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn tool_result_text(block: &Value) -> Option<String> {
    let content = block.get("content")?;
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    let arr = content.as_array()?;
    let joined = arr
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    if joined.trim().is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn is_subagent_tool_name(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    matches!(lower.as_str(), "task" | "taskcreate" | "agent" | "subagent")
}

fn normalize_agent_status(
    agent: &ParsedAgentInvocation,
    session_updated_at: i64,
    stale_after_ms: i64,
) -> String {
    if matches!(agent.status.as_str(), "succeeded" | "failed" | "cancelled" | "completed") {
        return agent.status.clone();
    }
    let age = unix_now_ms().saturating_sub(session_updated_at);
    if age > stale_after_ms {
        "stale".to_string()
    } else {
        "running".to_string()
    }
}

fn infer_session_status(updated_at: i64, stale_after_ms: i64) -> String {
    if unix_now_ms().saturating_sub(updated_at) > stale_after_ms {
        "stale".to_string()
    } else {
        "running".to_string()
    }
}

fn stage_from_agent_type(agent_type: &str) -> String {
    let lower = agent_type.to_ascii_lowercase();
    if lower.contains("research") || lower.contains("explore") {
        "research".to_string()
    } else if lower.contains("check") || lower.contains("review") || lower.contains("audit") {
        "check".to_string()
    } else if lower.contains("split") {
        "split".to_string()
    } else if lower.contains("verify") {
        "verify".to_string()
    } else if lower.contains("implement") || lower.contains("worker") {
        "implement".to_string()
    } else {
        "external-cli".to_string()
    }
}

fn terminal_completed_at(status: &str, updated_at: i64) -> Option<i64> {
    if matches!(status, "succeeded" | "failed" | "cancelled" | "completed" | "stale") {
        Some(updated_at)
    } else {
        None
    }
}

fn extract_task_path(text: &str) -> Option<String> {
    let re = Regex::new(r"(?P<path>\.trellis/tasks/[A-Za-z0-9_.\-/]+)").ok()?;
    re.captures(text)
        .and_then(|cap| cap.name("path"))
        .map(|m| m.as_str().trim_end_matches(['.', ',', ')', ']']).to_string())
}

fn task_id_from_path(path: &str) -> Option<String> {
    path.trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

fn sanitize_hook_detail(value: &Value) -> Value {
    json!({
        "type": string_field(value, "type"),
        "hookEvent": string_field(value, "hookEvent").or_else(|| string_field(value, "hook_event")),
        "hookName": string_field(value, "hookName"),
        "status": string_field(value, "status"),
        "stdout": string_field(value, "stdout").map(|s| excerpt(&s)),
        "stderr": string_field(value, "stderr").map(|s| excerpt(&s)),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_timestamp_ms(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis()),
        _ => None,
    }
}

fn excerpt(value: &str) -> String {
    let mut out = value.chars().take(MAX_TEXT_EXCERPT_CHARS).collect::<String>();
    if value.chars().nth(MAX_TEXT_EXCERPT_CHARS).is_some() {
        out.push_str("...");
    }
    out
}

fn external_agent_run_id(session_id: &str, tool_use_id: &str) -> String {
    format!(
        "external_claude_agent_{}",
        stable_hash(&format!("{session_id}:{tool_use_id}"))
    )
}

fn external_session_agent_run_id(session_id: &str) -> String {
    format!("external_claude_session_agent_{}", stable_hash(session_id))
}

fn stable_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest[..12]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
}

fn encoded_claude_project_dir(project_path: &Path) -> Result<String, String> {
    let canon = fs::canonicalize(project_path)
        .map_err(|e| format!("cannot canonicalize project path: {e}"))?;
    let s = canon.to_string_lossy().to_string();
    let normalized = if cfg!(windows) {
        let mut t = s.replace('\\', "/");
        if let Some(rest) = t.strip_prefix("//?/") {
            t = rest.to_string();
        }
        t.trim_start_matches('/').replace('/', "-").replace(':', "")
    } else {
        s.trim_start_matches('/').replace('/', "-")
    };
    Ok(format!("-{normalized}"))
}

fn is_safe_claude_session_filename(name: &str) -> bool {
    let len = name.len();
    (32..=48).contains(&len) && name.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn canonicalize_existing_dir(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("rootPath 不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("rootPath 必须是绝对路径".to_string());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("rootPath 不存在或无法访问: {e}"))?;
    if !canon.is_dir() {
        return Err("rootPath 必须是目录".to_string());
    }
    Ok(canon)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn unix_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_taskcreate_lifecycle_from_claude_jsonl() {
        let lines = vec![
            json!({
                "type": "assistant",
                "sessionId": "session-1",
                "timestamp": "2026-05-16T00:00:00.000Z",
                "cwd": "/work/wise",
                "message": {
                    "role": "assistant",
                    "model": "claude-opus",
                    "content": [{
                        "type": "tool_use",
                        "id": "tool-1",
                        "name": "TaskCreate",
                        "input": {
                            "subagent_type": "trellis-research",
                            "description": "Research Mission flow",
                            "prompt": "Read .trellis/tasks/05-16-mission/prd.md"
                        }
                    }]
                }
            })
            .to_string(),
            json!({
                "type": "user",
                "timestamp": "2026-05-16T00:00:05.000Z",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "tool-1",
                        "content": "done"
                    }]
                }
            })
            .to_string(),
        ];

        let parsed = parse_claude_session_lines("fallback", &lines, 1);

        assert_eq!(parsed.session_id, "session-1");
        assert_eq!(parsed.cwd.as_deref(), Some("/work/wise"));
        assert_eq!(parsed.model.as_deref(), Some("claude-opus"));
        assert_eq!(parsed.agents.len(), 1);
        assert_eq!(parsed.agents[0].agent_type, "trellis-research");
        assert_eq!(parsed.agents[0].stage, "research");
        assert_eq!(parsed.agents[0].status, "succeeded");
        assert_eq!(
            parsed.agents[0].task_path.as_deref(),
            Some(".trellis/tasks/05-16-mission/prd.md")
        );
    }

    #[test]
    fn parses_hook_success_attachment() {
        let lines = vec![json!({
            "timestamp": "2026-05-16T00:00:00.000Z",
            "attachment": {
                "type": "hook_success",
                "hookName": "SessionStart:startup",
                "hookEvent": "SessionStart",
                "stdout": "ok"
            }
        })
        .to_string()];

        let parsed = parse_claude_session_lines("session-1", &lines, 1);

        assert_eq!(parsed.hooks.len(), 1);
        assert_eq!(parsed.hooks[0].hook_event, "SessionStart");
        assert_eq!(parsed.hooks[0].status, "succeeded");
    }
}
