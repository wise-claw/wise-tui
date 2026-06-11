//! Tauri commands for assistants (builtin + custom + extension + overrides).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::builtins::{self, BuiltinAssistantBundle};
use super::hidden;
use super::overrides::{self, AssistantOverridesPatch, AssistantOverridesRow, ResetSection};
use super::runtime_resolver::{self, ResolveScopes, ResolvedRuntime};
use super::source::AssistantSource;
use super::storage::{self, CustomAssistantInput, CustomAssistantRow};
use crate::extensions::ExtensionRegistry;
use crate::wise_db::WiseDb;

/// Unified row returned to the UI. `source` discriminates ownership;
/// `customId` is set only for `Custom`; `extensionId` only for `Extension`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantEntry {
    pub id: String,
    pub source: AssistantSource,
    pub name: String,
    pub description: String,
    pub avatar_color: Option<String>,
    pub engine_id: String,
    pub model: Option<String>,
    /// Always populated for builtin / custom (system prompt as plain text).
    /// For extension assistants this is `None` — call
    /// `assistants_get_system_prompt` to load lazily.
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_path: Option<String>,
    /// True for Wise-shipped builtin templates (origin metadata only).
    #[serde(default)]
    pub built_in: bool,
    /// Tools the assistant can call(only populated for builtin).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tools: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub default_workflows: Vec<AssistantWorkflowRef>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub default_skills: Vec<AssistantBundleRef>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub default_mcps: Vec<AssistantBundleRef>,
    #[serde(skip_serializing_if = "is_default_entry_kind")]
    pub entry_kind: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub entry_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_workflow_id: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub entry_script: String,
    pub created_at: String,
    pub updated_at: String,
}

fn is_default_entry_kind(kind: &str) -> bool {
    kind == "conversation"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantBundleRef {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantWorkflowRef {
    pub id: String,
    pub stage: String,
    pub label: String,
    pub description: String,
}

const BUILTIN_EPOCH: &str = "2026-05-18T00:00:00Z";

fn builtin_to_entry(bundle: &BuiltinAssistantBundle) -> AssistantEntry {
    AssistantEntry {
        id: bundle.assistant_id.to_string(),
        source: AssistantSource::Builtin,
        name: bundle.name.to_string(),
        description: bundle.description.to_string(),
        avatar_color: Some(bundle.avatar_color.to_string()),
        engine_id: bundle.engine_id.to_string(),
        model: bundle.model.map(|s| s.to_string()),
        system_prompt: Some(bundle.system_prompt.to_string()),
        custom_id: None,
        extension_id: None,
        system_prompt_path: None,
        built_in: true,
        tools: bundle.tools.iter().map(|s| s.to_string()).collect(),
        default_workflows: bundle
            .default_workflows
            .iter()
            .map(|w| AssistantWorkflowRef {
                id: w.id.to_string(),
                stage: w.stage.to_string(),
                label: w.label.to_string(),
                description: w.description.to_string(),
            })
            .collect(),
        default_skills: bundle
            .default_skills
            .iter()
            .map(|s| AssistantBundleRef {
                id: s.id.to_string(),
                label: s.label.to_string(),
                source_path: Some(s.source_path.to_string()),
            })
            .collect(),
        default_mcps: bundle
            .default_mcps
            .iter()
            .map(|m| AssistantBundleRef {
                id: m.id.to_string(),
                label: m.label.to_string(),
                source_path: None,
            })
            .collect(),
        entry_kind: "conversation".to_string(),
        entry_url: String::new(),
        entry_workflow_id: None,
        entry_script: String::new(),
        created_at: BUILTIN_EPOCH.to_string(),
        updated_at: BUILTIN_EPOCH.to_string(),
    }
}

fn bundle_json_to_refs(json: &str) -> Vec<AssistantBundleRef> {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    let disabled: Vec<String> = value
        .get("disabled")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let disabled_set: std::collections::HashSet<&str> =
        disabled.iter().map(|s| s.as_str()).collect();
    value
        .get("custom")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.trim();
                    if id.is_empty() || disabled_set.contains(id) {
                        return None;
                    }
                    let label = item
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or(id)
                        .trim()
                        .to_string();
                    let source_path = item
                        .get("sourcePath")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    Some(AssistantBundleRef {
                        id: id.to_string(),
                        label,
                        source_path,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn custom_to_entry(row: CustomAssistantRow) -> AssistantEntry {
    AssistantEntry {
        id: format!("custom:{}", row.id),
        source: AssistantSource::Custom,
        name: row.name,
        description: row.description,
        avatar_color: row.avatar_color,
        engine_id: row.engine_id,
        model: row.model,
        system_prompt: Some(row.system_prompt),
        custom_id: Some(row.id),
        extension_id: None,
        system_prompt_path: None,
        built_in: false,
        default_workflows: Vec::new(),
        tools: Vec::new(),
        default_skills: Vec::new(),
        default_mcps: Vec::new(),
        entry_kind: row.entry_kind,
        entry_url: row.entry_url,
        entry_workflow_id: row.entry_workflow_id,
        entry_script: row.entry_script,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[tauri::command]
pub fn assistants_list(
    db: State<'_, WiseDb>,
    extensions: State<'_, ExtensionRegistry>,
) -> Result<Vec<AssistantEntry>, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    let hidden_ids = hidden::list_hidden_ids(&conn)?;

    let mut out = Vec::new();
    for bundle in builtins::list() {
        let entry = builtin_to_entry(bundle);
        if hidden_ids.contains(&entry.id) {
            continue;
        }
        out.push(entry);
    }

    let custom = storage::list(&conn)?;
    for c in custom {
        let mut entry = custom_to_entry(c);
        if hidden_ids.contains(&entry.id) {
            continue;
        }
        if let Some(overrides) = overrides::get(&conn, &entry.id, "assistant")? {
            entry.default_skills = bundle_json_to_refs(&overrides.skill_bundle_json);
            entry.default_mcps = bundle_json_to_refs(&overrides.mcp_bundle_json);
        }
        out.push(entry);
    }

    for ext_a in extensions.assistants() {
        if hidden_ids.contains(&ext_a.id) {
            continue;
        }
        out.push(AssistantEntry {
            id: ext_a.id.clone(),
            source: AssistantSource::Extension,
            name: ext_a.name,
            description: ext_a.description.unwrap_or_default(),
            avatar_color: ext_a.avatar_color,
            engine_id: ext_a.engine_id,
            model: ext_a.model,
            system_prompt: None,
            custom_id: None,
            extension_id: Some(ext_a.extension),
            system_prompt_path: Some(ext_a.system_prompt_path),
            built_in: false,
            tools: Vec::new(),
            default_workflows: Vec::new(),
            default_skills: Vec::new(),
            default_mcps: Vec::new(),
            entry_kind: "conversation".to_string(),
            entry_url: String::new(),
            entry_workflow_id: None,
            entry_script: String::new(),
            // Extension assistants don't carry timestamps; keep the
            // builtin epoch for stable ordering.
            created_at: BUILTIN_EPOCH.to_string(),
            updated_at: BUILTIN_EPOCH.to_string(),
        });
    }

    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCustomArgs {
    pub input: CustomAssistantInput,
}

#[tauri::command]
pub fn assistants_save_custom(
    db: State<'_, WiseDb>,
    args: SaveCustomArgs,
) -> Result<AssistantEntry, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    let row = storage::upsert(&conn, &args.input)?;
    Ok(custom_to_entry(row))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCustomArgs {
    pub custom_id: String,
}

#[tauri::command]
pub fn assistants_delete_custom(
    db: State<'_, WiseDb>,
    args: DeleteCustomArgs,
) -> Result<(), String> {
    assistants_delete_impl(&db, &format!("custom:{}", args.custom_id.trim()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAssistantArgs {
    pub id: String,
}

#[tauri::command]
pub fn assistants_delete(db: State<'_, WiseDb>, args: DeleteAssistantArgs) -> Result<(), String> {
    assistants_delete_impl(&db, args.id.trim())
}

fn assistants_delete_impl(db: &WiseDb, raw_id: &str) -> Result<(), String> {
    let id = raw_id.trim();
    if id.is_empty() {
        return Err("assistant id must not be empty".into());
    }

    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;

    if let Some(custom_id) = id.strip_prefix("custom:") {
        if custom_id.trim().is_empty() {
            return Err("custom assistant id must not be empty".into());
        }
        storage::delete(&conn, custom_id)?;
        overrides::delete_all_for_assistant(&conn, id)?;
        let _ = hidden::hide(&conn, id);
        return Ok(());
    }

    if id.starts_with("builtin:") {
        if builtins::find(id).is_none() {
            return Err(format!("unknown builtin assistant id {id}"));
        }
        hidden::hide(&conn, id)?;
        overrides::delete_all_for_assistant(&conn, id)?;
        return Ok(());
    }

    if id.starts_with("ext-") {
        hidden::hide(&conn, id)?;
        overrides::delete_all_for_assistant(&conn, id)?;
        return Ok(());
    }

    Err(format!("unknown assistant id {id}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptArgs {
    pub id: String,
}

/// Resolve the full system prompt for any assistant. Builtin / custom
/// already include the prompt in `assistants_list`; extension assistants
/// load the markdown body lazily through this command.
#[tauri::command]
pub fn assistants_get_system_prompt(
    db: State<'_, WiseDb>,
    extensions: State<'_, ExtensionRegistry>,
    args: SystemPromptArgs,
) -> Result<String, String> {
    if let Some(bundle) = builtins::find(&args.id) {
        return Ok(bundle.system_prompt.to_string());
    }
    if let Some(custom_id) = args.id.strip_prefix("custom:") {
        let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
        return storage::get_by_id(&conn, custom_id)?
            .map(|r| r.system_prompt)
            .ok_or_else(|| format!("no custom assistant with id {custom_id}"));
    }
    if args.id.starts_with("ext-") {
        return extensions.read_assistant_system_prompt(&args.id);
    }
    Err(format!("unknown assistant id {}", args.id))
}

// ── Overrides ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOverridesArgs {
    pub assistant_id: String,
    pub scope: String,
}

#[tauri::command]
pub fn assistants_get_overrides(
    db: State<'_, WiseDb>,
    args: GetOverridesArgs,
) -> Result<Option<AssistantOverridesRow>, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    overrides::get(&conn, &args.assistant_id, &args.scope)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOverridesArgs {
    pub assistant_id: String,
}

#[tauri::command]
pub fn assistants_list_overrides(
    db: State<'_, WiseDb>,
    args: ListOverridesArgs,
) -> Result<Vec<AssistantOverridesRow>, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    overrides::list_for_assistant(&conn, &args.assistant_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOverridesArgs {
    pub assistant_id: String,
    pub scope: String,
    #[serde(default)]
    pub patch: AssistantOverridesPatch,
}

#[tauri::command]
pub fn assistants_save_overrides(
    db: State<'_, WiseDb>,
    args: SaveOverridesArgs,
) -> Result<AssistantOverridesRow, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    overrides::save(&conn, &args.assistant_id, &args.scope, &args.patch)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetOverridesArgs {
    pub assistant_id: String,
    pub scope: String,
    #[serde(default)]
    pub sections: Vec<ResetSection>,
}

#[tauri::command]
pub fn assistants_reset_overrides(
    db: State<'_, WiseDb>,
    args: ResetOverridesArgs,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    overrides::reset(&conn, &args.assistant_id, &args.scope, &args.sections)
}

// ── Runtime resolver ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRuntimeArgs {
    pub assistant_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub repository_id: Option<String>,
}

#[tauri::command]
pub fn assistants_resolve_runtime(
    db: State<'_, WiseDb>,
    args: ResolveRuntimeArgs,
) -> Result<ResolvedRuntime, String> {
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    runtime_resolver::resolve(
        &conn,
        &args.assistant_id,
        ResolveScopes {
            project_id: args.project_id.as_deref(),
            repository_id: args.repository_id.as_deref(),
        },
    )
}
