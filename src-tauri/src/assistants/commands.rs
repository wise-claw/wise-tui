//! Tauri commands for assistants (builtin + custom + extension + overrides).

use serde::{Deserialize, Serialize};
use tauri::State;

use super::builtins::{self, BuiltinAssistantBundle};
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
    /// Builtins are not removable;UI hides delete control when this is `true`.
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
    pub created_at: String,
    pub updated_at: String,
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
        created_at: BUILTIN_EPOCH.to_string(),
        updated_at: BUILTIN_EPOCH.to_string(),
    }
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
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[tauri::command]
pub fn assistants_list(
    db: State<'_, WiseDb>,
    extensions: State<'_, ExtensionRegistry>,
) -> Result<Vec<AssistantEntry>, String> {
    let mut out = Vec::new();
    for bundle in builtins::list() {
        out.push(builtin_to_entry(bundle));
    }

    {
        let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
        let custom = storage::list(&conn)?;
        for c in custom {
            out.push(custom_to_entry(c));
        }
    }

    for ext_a in extensions.assistants() {
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
    let conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    storage::delete(&conn, &args.custom_id)
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
