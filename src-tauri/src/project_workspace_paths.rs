//! 项目根目录（`root_path`）与成员仓库路径的归属判定。

use std::path::{Path, PathBuf};

/// 展开前导 `~` / `~/`（Rust `Path` 不会自动处理，macOS 配置里常见）。
pub fn expand_tilde_in_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

/// 将已存在的目录规范为绝对路径（解析符号链接等）。
pub fn canonicalize_existing_dir(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    let p = expand_tilde_in_path(trimmed);
    if !p.exists() {
        return Err("路径不存在".to_string());
    }
    if !p.is_dir() {
        return Err("所选路径不是目录".to_string());
    }
    p.canonicalize().map_err(|e| format!("无法解析路径: {}", e))
}

/// `root` 与 `repo` 均需为 [`canonicalize_existing_dir`] 的输出。
pub fn assert_repo_dir_under_project_root(root: &Path, repo: &Path) -> Result<(), String> {
    if root == repo {
        return Ok(());
    }
    if repo.starts_with(root) {
        return Ok(());
    }
    Err(format!("仓库不在项目根目录下：{}", repo.to_string_lossy()))
}

/// 校验在父目录下新建的仓库文件夹名（不含路径分隔符）。
pub fn validate_repository_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件夹名不能为空".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("文件夹名无效".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("文件夹名不能包含路径分隔符".to_string());
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn canonicalize_nested_child_passes() {
        let base = std::env::temp_dir().join(format!(
            "wise_project_root_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("child")).unwrap();
        let root = canonicalize_existing_dir(&base.to_string_lossy()).unwrap();
        let child = canonicalize_existing_dir(&base.join("child").to_string_lossy()).unwrap();
        assert_repo_dir_under_project_root(&root, &child).unwrap();
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sibling_path_fails() {
        let base = std::env::temp_dir().join(format!(
            "wise_project_root_test2_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("a")).unwrap();
        fs::create_dir_all(base.join("b")).unwrap();
        let root = canonicalize_existing_dir(&base.join("a").to_string_lossy()).unwrap();
        let other = canonicalize_existing_dir(&base.join("b").to_string_lossy()).unwrap();
        assert!(assert_repo_dir_under_project_root(&root, &other).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
