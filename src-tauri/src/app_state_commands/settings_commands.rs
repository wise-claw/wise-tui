use crate::wise_db;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrdTaskRequirementHistoryItem {
    id: String,
    requirement_display_name: String,
    #[serde(default)]
    is_pinned: bool,
    input_value: String,
    #[serde(default)]
    original_input_value: Option<String>,
    context_mode: String,
    linked_project_id: Option<String>,
    linked_repository_id: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrdTaskDraftPayload {
    input_value: String,
    #[serde(default)]
    original_input_value: Option<String>,
    context_mode: String,
    linked_project_id: Option<String>,
    linked_repository_id: Option<i64>,
    /// 用户首次保存需求时填写；已持久化后后续保存不再弹窗。
    #[serde(default)]
    requirement_display_name: Option<String>,
    #[serde(default)]
    current_requirement_id: Option<String>,
    #[serde(default)]
    requirements: Option<Vec<PrdTaskRequirementHistoryItem>>,
}

#[tauri::command]
pub(crate) fn get_task_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<Option<String>, String> {
    let storage_key = match key.as_str() {
        "repositorySplit" => "task_template_repository_split",
        "projectSplit" => "task_template_project_split",
        _ => return Err("不支持的模板 key".to_string()),
    };
    db.get_setting(storage_key)
}

#[tauri::command]
pub(crate) fn set_task_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    let storage_key = match key.as_str() {
        "repositorySplit" => "task_template_repository_split",
        "projectSplit" => "task_template_project_split",
        _ => return Err("不支持的模板 key".to_string()),
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("模板内容不能为空".to_string());
    }
    db.set_setting(storage_key, trimmed)
}

fn repo_task_split_prompt_storage_key(repository_id: i64) -> String {
    format!("repo_task_split_prompt:{repository_id}")
}

#[tauri::command]
pub(crate) fn get_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<Option<String>, String> {
    db.get_setting(&repo_task_split_prompt_storage_key(repository_id))
}

#[tauri::command]
pub(crate) fn set_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("提示词内容不能为空".to_string());
    }
    db.set_setting(&repo_task_split_prompt_storage_key(repository_id), trimmed)
}

#[tauri::command]
pub(crate) fn clear_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<(), String> {
    db.delete_setting(&repo_task_split_prompt_storage_key(repository_id))
}

fn project_split_prompt_layers_storage_key(project_id: &str) -> String {
    format!("split_prompt_layers:project:{project_id}")
}

fn repository_split_prompt_layers_storage_key(repository_id: i64) -> String {
    format!("split_prompt_layers:repo:{repository_id}")
}

const PLATFORM_SPLIT_PROMPT_LAYERS_KEY: &str = "split_prompt_layers:platform_default";

#[tauri::command]
pub(crate) fn get_platform_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<String>, String> {
    db.get_setting(PLATFORM_SPLIT_PROMPT_LAYERS_KEY)
}

#[tauri::command]
pub(crate) fn get_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<Option<String>, String> {
    db.get_setting(&project_split_prompt_layers_storage_key(project_id.trim()))
}

#[tauri::command]
pub(crate) fn set_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("JSON 内容不能为空".to_string());
    }
    serde_json::from_str::<serde_json::Value>(trimmed).map_err(|e| format!("JSON 无效: {}", e))?;
    db.set_setting(
        &project_split_prompt_layers_storage_key(project_id.trim()),
        trimmed,
    )
}

#[tauri::command]
pub(crate) fn clear_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<(), String> {
    db.delete_setting(&project_split_prompt_layers_storage_key(project_id.trim()))
}

#[tauri::command]
pub(crate) fn get_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<Option<String>, String> {
    db.get_setting(&repository_split_prompt_layers_storage_key(repository_id))
}

#[tauri::command]
pub(crate) fn set_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("JSON 内容不能为空".to_string());
    }
    serde_json::from_str::<serde_json::Value>(trimmed).map_err(|e| format!("JSON 无效: {}", e))?;
    db.set_setting(
        &repository_split_prompt_layers_storage_key(repository_id),
        trimmed,
    )
}

#[tauri::command]
pub(crate) fn clear_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<(), String> {
    db.delete_setting(&repository_split_prompt_layers_storage_key(repository_id))
}

#[tauri::command]
pub(crate) fn get_prd_task_draft(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<PrdTaskDraftPayload>, String> {
    let raw = db.get_setting("prd_task_draft")?;
    if let Some(value) = raw {
        let parsed: PrdTaskDraftPayload =
            serde_json::from_str(&value).map_err(|e| format!("解析 PRD 草稿失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn set_prd_task_draft(
    db: tauri::State<'_, wise_db::WiseDb>,
    payload: PrdTaskDraftPayload,
) -> Result<(), String> {
    if payload.context_mode != "project" && payload.context_mode != "repository" {
        return Err("contextMode 仅支持 project/repository".to_string());
    }
    if let Some(requirements) = &payload.requirements {
        for item in requirements {
            if item.context_mode != "project" && item.context_mode != "repository" {
                return Err("requirements[].contextMode 仅支持 project/repository".to_string());
            }
        }
    }
    let raw = serde_json::to_string(&payload).map_err(|e| format!("序列化 PRD 草稿失败: {}", e))?;
    db.set_setting("prd_task_draft", &raw)
}

#[tauri::command]
pub(crate) fn clear_prd_task_draft(db: tauri::State<'_, wise_db::WiseDb>) -> Result<(), String> {
    db.delete_setting("prd_task_draft")
}

#[tauri::command]
pub(crate) fn get_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<Option<String>, String> {
    db.get_setting(key.trim())
}

#[tauri::command]
pub(crate) fn get_app_settings_batch(
    db: tauri::State<'_, wise_db::WiseDb>,
    keys: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    let mut out = std::collections::HashMap::new();
    for key in keys {
        let normalized = key.trim();
        if normalized.is_empty() {
            continue;
        }
        if out.contains_key(normalized) {
            continue;
        }
        out.insert(normalized.to_string(), db.get_setting(normalized)?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn set_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    const MAX_APP_SETTING_SIZE: usize = 2 * 1024 * 1024;
    let normalized_key = key.trim();
    if normalized_key.is_empty() {
        return Err("setting key 不能为空".to_string());
    }
    if value.len() > MAX_APP_SETTING_SIZE {
        return Err("setting value 过大（超过 2MB）".to_string());
    }
    db.set_setting(normalized_key, &value)
}

#[tauri::command]
pub(crate) fn delete_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<(), String> {
    db.delete_setting(key.trim())
}

#[tauri::command]
pub(crate) fn get_prd_task_split_result(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_prd_task_split_payload()?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析任务拆分结果失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn set_prd_task_split_result(
    db: tauri::State<'_, wise_db::WiseDb>,
    split: serde_json::Value,
    executable: serde_json::Value,
) -> Result<(), String> {
    if !split.is_object() {
        return Err("任务拆分结果格式无效".to_string());
    }
    let split_raw =
        serde_json::to_string(&split).map_err(|e| format!("序列化任务拆分结果失败: {}", e))?;
    let executable_raw =
        serde_json::to_string(&executable).map_err(|e| format!("序列化可执行任务失败: {}", e))?;
    db.set_prd_task_split_and_executable_payloads(&split_raw, &executable_raw)
}

#[tauri::command]
pub(crate) fn get_prd_executable_tasks_result(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_prd_executable_tasks_payload()?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析可执行任务失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn clear_prd_task_split_result(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<(), String> {
    db.clear_prd_task_split_payload()
}
