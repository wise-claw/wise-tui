use crate::wise_db;

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
