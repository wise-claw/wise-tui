//! Reference-aware garbage collection for `~/.wise/composer-images/`.

use crate::claude_config_dir;
use crate::wise_db::WiseDb;
use crate::wise_paths::{self, wise_dir};
use tauri::Manager;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const COMPOSER_IMAGE_GC_SETTINGS_KEY: &str = "wise.composerImageGc.v1";

/// 无引用图片至少保留 24h，避免编辑器内未发送附图被误删。
pub const DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS: u32 = 24;
/// 超过 30 天且无引用的图片可回收。
pub const DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS: u32 = 30;
/// 目录总量超过 500MB 时，在 grace 之后按最旧优先回收无引用文件（0 = 不按容量强制回收）。
pub const DEFAULT_COMPOSER_IMAGE_GC_MAX_MB: u32 = 500;
/// 后台扫描间隔。
pub const COMPOSER_IMAGE_GC_SCAN_INTERVAL_SECS: u64 = 6 * 60 * 60;
/// 启动后延迟首次扫描，避免与 tabs 恢复争抢 IO。
pub const COMPOSER_IMAGE_GC_STARTUP_DELAY_SECS: u64 = 60;

static COMPOSER_PATH_IN_TEXT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"附图[：:][^\n]*?@(/[^\s\n"}\],]+)"#).expect("composer path regex")
});

static COMPOSER_PATH_JSON_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#""path"\s*:\s*"([^"]+composer-images[^"]+)""#).expect("json path regex")
});

#[derive(Debug, Clone)]
struct ComposerImageFile {
    path: PathBuf,
    modified_secs: u64,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerImageGcResult {
    pub scanned_files: u64,
    pub referenced_files: u64,
    pub removed_files: u64,
    pub freed_bytes: u64,
    pub remaining_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerImageGcConfig {
    /// 无引用图片保留天数，超过后可回收。
    pub ttl_days: u32,
    /// 新落盘图片保护小时数，避免未发送附图被误删。
    pub grace_hours: u32,
    /// 目录容量上限（MB）；0 表示仅按 TTL 回收，不按容量强制回收。
    pub max_mb: u32,
}

impl Default for ComposerImageGcConfig {
    fn default() -> Self {
        Self {
            ttl_days: DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS,
            grace_hours: DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS,
            max_mb: DEFAULT_COMPOSER_IMAGE_GC_MAX_MB,
        }
    }
}

impl ComposerImageGcConfig {
    pub fn normalized(self) -> Self {
        Self {
            ttl_days: self.ttl_days.clamp(1, 365),
            grace_hours: self.grace_hours.clamp(1, 168),
            max_mb: self.max_mb.clamp(0, 10_240),
        }
    }

    pub fn grace_secs(&self) -> u64 {
        u64::from(self.grace_hours) * 3600
    }

    pub fn ttl_secs(&self) -> u64 {
        u64::from(self.ttl_days) * 24 * 3600
    }

    pub fn max_bytes(&self) -> u64 {
        if self.max_mb == 0 {
            return u64::MAX;
        }
        u64::from(self.max_mb) * 1024 * 1024
    }
}

pub fn load_composer_image_gc_config(db: &WiseDb) -> ComposerImageGcConfig {
    let Ok(Some(raw)) = db.get_setting(COMPOSER_IMAGE_GC_SETTINGS_KEY) else {
        return ComposerImageGcConfig::default();
    };
    serde_json::from_str::<ComposerImageGcConfig>(&raw)
        .map(|c| c.normalized())
        .unwrap_or_default()
}

pub fn save_composer_image_gc_config(db: &WiseDb, config: ComposerImageGcConfig) -> Result<(), String> {
    let normalized = config.normalized();
    let raw = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    db.set_setting(COMPOSER_IMAGE_GC_SETTINGS_KEY, &raw)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerImageGcStats {
    pub total_files: u64,
    pub total_bytes: u64,
    pub referenced_files: u64,
    pub referenced_bytes: u64,
    pub gc_eligible_files: u64,
    pub gc_eligible_bytes: u64,
}

fn system_time_to_secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn trim_attachment_path(raw: &str) -> String {
    raw.trim()
        .trim_end_matches([
            '。', '．', '.', '，', ',', '；', ';', '！', '!', '？', '?', '）', ')', ']', '}', '」', '』', '"',
            '\'', '`',
        ])
        .to_string()
}

fn normalize_composer_path(candidate: &str, composer_root: &Path) -> Option<PathBuf> {
    let trimmed = trim_attachment_path(candidate);
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(&trimmed);
    if !path.is_absolute() {
        return None;
    }
    if !path.starts_with(composer_root) {
        return None;
    }
    Some(path)
}

fn extract_composer_paths_from_text(text: &str, composer_root: &Path, out: &mut HashSet<PathBuf>) {
    for cap in COMPOSER_PATH_IN_TEXT_RE.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            if let Some(path) = normalize_composer_path(m.as_str(), composer_root) {
                out.insert(path);
            }
        }
    }
    for cap in COMPOSER_PATH_JSON_RE.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            if let Some(path) = normalize_composer_path(m.as_str(), composer_root) {
                out.insert(path);
            }
        }
    }
    let marker = "composer-images/";
    let mut start = 0usize;
    while let Some(idx) = text[start..].find(marker) {
        let abs = start + idx;
        let mut path_start = abs;
        while path_start > 0 {
            let ch = text.as_bytes()[path_start - 1];
            if ch == b'/' {
                path_start -= 1;
                break;
            }
            if ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'_' | b'-') {
                path_start -= 1;
            } else {
                break;
            }
        }
        let after = text[abs..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']' | '}' | '，' | '。'))
            .unwrap_or(text[abs..].len());
        let slice = &text[path_start..abs + after];
        if let Some(path) = normalize_composer_path(slice, composer_root) {
            out.insert(path);
        }
        start = abs + marker.len();
        if start >= text.len() {
            break;
        }
    }
}

fn read_text_file(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn collect_referenced_paths_from_tabs(composer_root: &Path, out: &mut HashSet<PathBuf>) -> Result<(), String> {
    let path = wise_paths::wise_tabs_json()?;
    if !path.is_file() {
        return Ok(());
    }
    let text = read_text_file(&path).ok_or_else(|| "无法读取 tabs.json".to_string())?;
    extract_composer_paths_from_text(&text, composer_root, out);
    Ok(())
}

fn collect_referenced_paths_from_cursor_runs(composer_root: &Path, out: &mut HashSet<PathBuf>) {
    let Ok(root) = wise_dir() else {
        return;
    };
    let runs = root.join("cursor-runs");
    collect_referenced_paths_from_jsonl_tree(&runs, composer_root, out);
}

fn collect_referenced_paths_from_claude_projects(composer_root: &Path, out: &mut HashSet<PathBuf>) {
    let projects = claude_config_dir::user_claude_dir().join("projects");
    collect_referenced_paths_from_jsonl_tree(&projects, composer_root, out);
}

fn collect_referenced_paths_from_jsonl_tree(root: &Path, composer_root: &Path, out: &mut HashSet<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    let entries = match fs::read_dir(root) {
        Ok(v) => v,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            collect_referenced_paths_from_jsonl_tree(&path, composer_root, out);
        } else if ft.is_file() {
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            collect_referenced_paths_from_jsonl_file(&path, composer_root, out);
        }
    }
}

fn collect_referenced_paths_from_jsonl_file(path: &Path, composer_root: &Path, out: &mut HashSet<PathBuf>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let reader = std::io::BufReader::new(file);
    for (i, line) in reader.lines().enumerate() {
        if i > 4000 {
            break;
        }
        let Ok(line) = line else {
            break;
        };
        extract_composer_paths_from_text(&line, composer_root, out);
    }
}

pub fn collect_referenced_composer_image_paths(composer_root: &Path) -> Result<HashSet<PathBuf>, String> {
    let mut out = HashSet::new();
    collect_referenced_paths_from_tabs(composer_root, &mut out)?;
    collect_referenced_paths_from_cursor_runs(composer_root, &mut out);
    collect_referenced_paths_from_claude_projects(composer_root, &mut out);
    Ok(out)
}

fn list_composer_image_files(composer_root: &Path) -> Result<Vec<ComposerImageFile>, String> {
    if !composer_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let entries = fs::read_dir(composer_root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            for sub in list_composer_image_files(&path)? {
                files.push(sub);
            }
        } else if ft.is_file() {
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            let modified_secs = meta
                .modified()
                .map(system_time_to_secs)
                .unwrap_or(0);
            files.push(ComposerImageFile {
                path,
                modified_secs,
                size: meta.len(),
            });
        }
    }
    Ok(files)
}

fn is_gc_eligible(
    file: &ComposerImageFile,
    referenced: &HashSet<PathBuf>,
    now_secs: u64,
    config: &ComposerImageGcConfig,
) -> bool {
    if referenced.contains(&file.path) {
        return false;
    }
    let age_secs = now_secs.saturating_sub(file.modified_secs);
    if age_secs < config.grace_secs() {
        return false;
    }
    age_secs >= config.ttl_secs()
}

fn compute_gc_stats(
    files: &[ComposerImageFile],
    referenced: &HashSet<PathBuf>,
    now_secs: u64,
    config: &ComposerImageGcConfig,
) -> ComposerImageGcStats {
    let mut total_files = 0u64;
    let mut total_bytes = 0u64;
    let mut referenced_files = 0u64;
    let mut referenced_bytes = 0u64;
    let mut gc_eligible_files = 0u64;
    let mut gc_eligible_bytes = 0u64;

    for file in files {
        total_files += 1;
        total_bytes += file.size;
        if referenced.contains(&file.path) {
            referenced_files += 1;
            referenced_bytes += file.size;
        } else if is_gc_eligible(file, referenced, now_secs, config) {
            gc_eligible_files += 1;
            gc_eligible_bytes += file.size;
        }
    }

    ComposerImageGcStats {
        total_files,
        total_bytes,
        referenced_files,
        referenced_bytes,
        gc_eligible_files,
        gc_eligible_bytes,
    }
}

fn select_files_to_remove<'a>(
    files: &'a [ComposerImageFile],
    referenced: &HashSet<PathBuf>,
    now_secs: u64,
    config: &ComposerImageGcConfig,
) -> Vec<&'a ComposerImageFile> {
    let removable: Vec<&ComposerImageFile> = files
        .iter()
        .filter(|f| is_gc_eligible(f, referenced, now_secs, config))
        .collect();

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let max_bytes = config.max_bytes();
    if total_bytes <= max_bytes {
        return removable;
    }

    let mut over_budget = total_bytes.saturating_sub(max_bytes);
    let mut pressure: Vec<&ComposerImageFile> = files
        .iter()
        .filter(|f| {
            if referenced.contains(&f.path) {
                return false;
            }
            let age_secs = now_secs.saturating_sub(f.modified_secs);
            age_secs >= config.grace_secs()
        })
        .collect();
    pressure.sort_by_key(|f| f.modified_secs);

    let mut selected: HashSet<&Path> = removable.iter().map(|f| f.path.as_path()).collect();
    for file in pressure {
        if over_budget == 0 {
            break;
        }
        if selected.insert(file.path.as_path()) {
            over_budget = over_budget.saturating_sub(file.size);
        }
    }

    files
        .iter()
        .filter(|f| selected.contains(f.path.as_path()))
        .collect()
}

pub fn composer_image_gc_stats_with_config(
    config: &ComposerImageGcConfig,
) -> Result<ComposerImageGcStats, String> {
    let composer_root = wise_dir()?.join("composer-images");
    let referenced = collect_referenced_composer_image_paths(&composer_root)?;
    let files = list_composer_image_files(&composer_root)?;
    let now_secs = system_time_to_secs(SystemTime::now());
    Ok(compute_gc_stats(&files, &referenced, now_secs, config))
}

pub fn composer_image_gc_stats(db: &WiseDb) -> Result<ComposerImageGcStats, String> {
    let config = load_composer_image_gc_config(db);
    composer_image_gc_stats_with_config(&config)
}

pub fn run_composer_image_gc_with_config(
    config: &ComposerImageGcConfig,
) -> Result<ComposerImageGcResult, String> {
    let composer_root = wise_dir()?.join("composer-images");
    let referenced = collect_referenced_composer_image_paths(&composer_root)?;
    let files = list_composer_image_files(&composer_root)?;
    let now_secs = system_time_to_secs(SystemTime::now());
    let to_remove = select_files_to_remove(&files, &referenced, now_secs, config);

    let mut removed_files = 0u64;
    let mut freed_bytes = 0u64;
    for file in to_remove {
        if fs::remove_file(&file.path).is_ok() {
            removed_files += 1;
            freed_bytes += file.size;
        }
    }

    prune_empty_dirs(&composer_root);

    let remaining_bytes: u64 = list_composer_image_files(&composer_root)?
        .iter()
        .map(|f| f.size)
        .sum();

    Ok(ComposerImageGcResult {
        scanned_files: files.len() as u64,
        referenced_files: files
            .iter()
            .filter(|f| referenced.contains(&f.path))
            .count() as u64,
        removed_files,
        freed_bytes,
        remaining_bytes,
    })
}

pub fn run_composer_image_gc(db: &WiseDb) -> Result<ComposerImageGcResult, String> {
    let config = load_composer_image_gc_config(db);
    run_composer_image_gc_with_config(&config)
}

fn prune_empty_dirs(root: &Path) {
    let entries = match fs::read_dir(root) {
        Ok(v) => v,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        prune_empty_dirs(&path);
        let _ = fs::remove_dir(&path);
    }
}

pub fn spawn_composer_image_gc_scanner(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(COMPOSER_IMAGE_GC_STARTUP_DELAY_SECS)).await;
        if let Some(db) = app.try_state::<WiseDb>() {
            match run_composer_image_gc(&db) {
                Ok(result) if result.removed_files > 0 => {
                    eprintln!(
                        "[composer_image_gc] startup removed {} files, freed {} bytes",
                        result.removed_files, result.freed_bytes
                    );
                }
                Err(error) => {
                    eprintln!("[composer_image_gc] startup scan failed: {error}");
                }
                _ => {}
            }
        }

        loop {
            tokio::time::sleep(Duration::from_secs(COMPOSER_IMAGE_GC_SCAN_INTERVAL_SECS)).await;
            let Some(db) = app.try_state::<WiseDb>() else {
                continue;
            };
            if let Err(error) = run_composer_image_gc(&db) {
                eprintln!("[composer_image_gc] periodic scan failed: {error}");
            }
        }
    });
}

#[tauri::command]
pub fn get_composer_image_gc_stats(db: tauri::State<'_, WiseDb>) -> Result<ComposerImageGcStats, String> {
    composer_image_gc_stats(&db)
}

#[tauri::command]
pub fn run_composer_image_gc_command(db: tauri::State<'_, WiseDb>) -> Result<ComposerImageGcResult, String> {
    run_composer_image_gc(&db)
}

#[tauri::command]
pub fn get_composer_image_gc_config(db: tauri::State<'_, WiseDb>) -> Result<ComposerImageGcConfig, String> {
    Ok(load_composer_image_gc_config(&db))
}

#[tauri::command]
pub fn set_composer_image_gc_config(
    db: tauri::State<'_, WiseDb>,
    config: ComposerImageGcConfig,
) -> Result<ComposerImageGcConfig, String> {
    let normalized = config.normalized();
    save_composer_image_gc_config(&db, normalized.clone())?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extract_paths_from_futu_suffix() {
        let root = PathBuf::from("/Users/x/.wise/composer-images");
        let text = "你好\n\n附图：@/Users/x/.wise/composer-images/demo/uuid-image.png";
        let mut out = HashSet::new();
        extract_composer_paths_from_text(text, &root, &mut out);
        assert_eq!(
            out.into_iter().next().map(|p| p.to_string_lossy().to_string()),
            Some("/Users/x/.wise/composer-images/demo/uuid-image.png".to_string())
        );
    }

    #[test]
    fn gc_skips_referenced_and_recent_files() {
        let now = system_time_to_secs(SystemTime::now());
        let referenced_path = PathBuf::from("/tmp/.wise/composer-images/demo/ref.png");
        let old_unref = PathBuf::from("/tmp/.wise/composer-images/demo/old.png");
        let recent_unref = PathBuf::from("/tmp/.wise/composer-images/demo/recent.png");

        let config = ComposerImageGcConfig::default();
        let files = vec![
            ComposerImageFile {
                path: referenced_path.clone(),
                modified_secs: now.saturating_sub(config.ttl_secs() + 3600),
                size: 3,
            },
            ComposerImageFile {
                path: old_unref.clone(),
                modified_secs: now.saturating_sub(config.ttl_secs() + 3600),
                size: 3,
            },
            ComposerImageFile {
                path: recent_unref.clone(),
                modified_secs: now.saturating_sub(60),
                size: 3,
            },
        ];

        let mut referenced = HashSet::new();
        referenced.insert(referenced_path);

        let to_remove = select_files_to_remove(&files, &referenced, now, &config);
        assert_eq!(to_remove.len(), 1);
        assert_eq!(to_remove[0].path, old_unref);
    }

    #[test]
    fn config_normalization_clamps_out_of_range_values() {
        let config = ComposerImageGcConfig {
            ttl_days: 0,
            grace_hours: 999,
            max_mb: 99_999,
        }
        .normalized();
        assert_eq!(config.ttl_days, 1);
        assert_eq!(config.grace_hours, 168);
        assert_eq!(config.max_mb, 10_240);
        assert_eq!(config.max_bytes(), 10_240 * 1024 * 1024);
    }

    #[test]
    fn zero_max_mb_disables_capacity_pressure() {
        let config = ComposerImageGcConfig {
            ttl_days: 30,
            grace_hours: 24,
            max_mb: 0,
        }
        .normalized();
        assert_eq!(config.max_bytes(), u64::MAX);
    }

    #[test]
    fn tabs_json_reference_is_detected() {
        let base = std::env::temp_dir().join(format!("wise-gc-tabs-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let tabs = base.join("tabs.json");
        let img = "/Users/x/.wise/composer-images/demo/uuid-image.png";
        let json = format!(r#"{{"version":1,"sessions":[{{"messages":[{{"content":"附图：@{img}"}}]}}]}}"#);
        let mut f = fs::File::create(&tabs).unwrap();
        f.write_all(json.as_bytes()).unwrap();

        // Temporarily override is not possible; test extractor only.
        let mut out = HashSet::new();
        extract_composer_paths_from_text(&json, Path::new("/Users/x/.wise/composer-images"), &mut out);
        assert!(out.contains(&PathBuf::from(img)));

        let _ = fs::remove_dir_all(&base);
    }
}
