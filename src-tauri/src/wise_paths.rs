use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn wise_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not resolve home directory".to_string())
        .map(|h| h.join(".wise"))
}

pub(crate) fn wise_repositories_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("repositories.json"))
}

pub(crate) fn wise_legacy_projects_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("projects.json"))
}

pub(crate) fn wise_tabs_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("tabs.json"))
}

pub(crate) fn sanitize_window_label_for_filename(label: &str) -> String {
    label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// 主窗口沿用 `tabs.json`；辅助主窗口使用 `tabs/<label>.json` 独立持久化。
/// 非主工作区窗口（如 mascot）不得落到主窗 `tabs.json`，避免串写。
pub(crate) fn wise_tabs_json_for_window(window_label: Option<&str>) -> Result<PathBuf, String> {
    let wise = wise_dir()?;
    match window_label.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("main") => Ok(wise.join("tabs.json")),
        Some(label) if label.starts_with("main-dock-") => Ok(
            wise.join("tabs")
                .join(format!("{}.json", sanitize_window_label_for_filename(label))),
        ),
        Some(other) => Err(format!(
            "unsupported window label for session tabs: {other}"
        )),
    }
}

/// 同一进程内连续写入的序号：保证不会复用同一个临时文件名。
static ATOMIC_WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

/// 原子写临时文件路径：与目标同目录，名字带进程 id / 序号 / 纳秒后缀。
///
/// 旧实现固定使用 `<name>.json.save_tmp`。Wise 可能同时有两个进程（打包版与 dev 版，
/// 或用户启动两次）写同一个 `~/.wise/tabs.json`；共用同一临时文件时，一方 `rename`
/// 会把另一方正在写的内容搬走或写坏，表现为「写盘静默失败」或「tabs.json 变成解析不了的
/// JSON」——后者会让下次启动读不出整份会话列表，只剩空的新会话。
/// 临时名唯一后，每个写入者只搬自己的文件，互不影响。
fn atomic_write_tmp_path(path: &Path) -> PathBuf {
    let seq = ATOMIC_WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "wise_state".to_string());
    let tmp_name = format!(".{file_name}.{}.{seq}.{nanos}.tmp", std::process::id());
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(tmp_name),
        _ => PathBuf::from(tmp_name),
    }
}

pub(crate) fn write_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = atomic_write_tmp_path(path);
    if let Err(err) = fs::write(&tmp, contents) {
        let _ = fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    #[cfg(windows)]
    if path.exists() {
        if let Err(err) = fs::remove_file(path) {
            let _ = fs::remove_file(&tmp);
            return Err(err.to_string());
        }
    }
    if let Err(err) = fs::rename(&tmp, path) {
        // 失败时清掉临时文件，避免 .wise 目录里堆积写了一半的快照。
        let _ = fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{atomic_write_tmp_path, wise_tabs_json_for_window, write_file_atomic};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 并行测试用序号，避免不同测试共用同一个临时目录。
    static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let seq = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("{prefix}-{}-{seq}", std::process::id()))
    }

    #[test]
    fn primary_and_missing_label_use_tabs_json() {
        let primary = wise_tabs_json_for_window(Some("main")).expect("main");
        let missing = wise_tabs_json_for_window(None).expect("none");
        assert!(primary.ends_with("tabs.json"));
        assert_eq!(primary, missing);
    }

    #[test]
    fn aux_dock_label_uses_isolated_tabs_file() {
        let path = wise_tabs_json_for_window(Some("main-dock-123")).expect("dock");
        assert!(path.to_string_lossy().contains("tabs"));
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("main-dock-123"));
    }

    #[test]
    fn unsupported_label_does_not_fall_through_to_main_tabs() {
        let err = wise_tabs_json_for_window(Some("mascot")).expect_err("mascot");
        assert!(err.contains("unsupported window label"));
    }

    #[test]
    fn atomic_write_tmp_paths_are_unique_and_target_scoped() {
        let target = PathBuf::from("/tmp/wise-atomic-test/tabs.json");
        let first = atomic_write_tmp_path(&target);
        let second = atomic_write_tmp_path(&target);
        assert_ne!(first, second, "同一目标的两次写入不能共用临时文件");
        assert_eq!(first.parent(), target.parent(), "临时文件必须与目标同目录");
        assert_ne!(first, target, "临时文件不能是目标本身");
    }

    #[test]
    fn concurrent_writers_do_not_corrupt_each_others_snapshots() {
        let dir = unique_test_dir("wise-atomic-race");
        fs::create_dir_all(&dir).expect("dir");
        let target = dir.join("tabs.json");

        // 模拟两个实例同时写同一个 tabs.json：临时文件互不复用，落盘内容必须完整。
        let first_tmp = atomic_write_tmp_path(&target);
        let second_tmp = atomic_write_tmp_path(&target);
        fs::write(&first_tmp, r#"{"writer":1}"#).expect("write first");
        fs::write(&second_tmp, r#"{"writer":2}"#).expect("write second");
        assert!(first_tmp.exists() && second_tmp.exists());
        fs::rename(&first_tmp, &target).expect("rename first");
        fs::rename(&second_tmp, &target).expect("rename second");
        assert_eq!(fs::read_to_string(&target).expect("read"), r#"{"writer":2}"#);

        write_file_atomic(&target, r#"{"writer":3}"#).expect("atomic write");
        assert_eq!(fs::read_to_string(&target).expect("read"), r#"{"writer":3}"#);
        let leftovers: Vec<String> = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "写完不应残留临时文件: {leftovers:?}");

        let _ = fs::remove_dir_all(&dir);
    }
}
