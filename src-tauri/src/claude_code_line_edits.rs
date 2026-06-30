//! 从本机 Claude Code 项目 JSONL 汇总 AI 代码编辑量（Edit / Write / MultiEdit 等工具调用）。
//! 与 `claude_code_usage` 共用扫描路径，独立命令以便按需加载。

use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone, Utc, Weekday};
use rayon::prelude::*;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::claude_commands::disk_sessions::encoded_claude_project_dir;

const MAX_JSONL_FILES: usize = 5000;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const READ_BUF_CAP: usize = 256 * 1024;
/// 热力图展示近一年；扫描窗口与展示一致。
const HEATMAP_DAYS: i64 = 364;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLineEditsDayBucket {
    pub date: String,
    pub lines_edited: u64,
    pub diff_count: u64,
    /// 新增行数：Edit/MultiEdit 的 new_string 净增；Write/Write_File 全部计入。
    pub lines_added: u64,
    /// 删除行数：Edit/MultiEdit 的 old_string 净减；Write/Write_File 始终为 0。
    pub lines_removed: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLineEditsSnapshotResponse {
    pub total_lines_edited: u64,
    pub total_lines_added: u64,
    pub total_lines_removed: u64,
    pub total_diff_count: u64,
    pub days: Vec<ClaudeLineEditsDayBucket>,
    /// 最近 7 天聚合；空数据时为 None。
    pub last_7_days: Option<ClaudeLineEditsWindowSummary>,
    /// 最近 30 天聚合；空数据时为 None。
    pub last_30_days: Option<ClaudeLineEditsWindowSummary>,
    pub most_active_month: Option<String>,
    pub most_active_day: Option<String>,
    pub longest_streak_days: u32,
    pub current_streak_days: u32,
    pub scanned_files: u32,
    pub data_roots: Vec<String>,
    pub hint: Option<String>,
    pub events_parsed: u64,
}

/// 固定时间窗口内的代码编辑量聚合。`days` 是按日期升序（最早 → 最近）的桶数组。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLineEditsWindowSummary {
    pub lines_edited: u64,
    pub lines_added: u64,
    pub lines_removed: u64,
    pub diff_count: u64,
}

/// 从按时间升序的日桶数组中取最近 N 天聚合。`days` 为空时返回 None。
fn window_summary(days: &[ClaudeLineEditsDayBucket], n: usize) -> Option<ClaudeLineEditsWindowSummary> {
    if days.is_empty() || n == 0 {
        return None;
    }
    let take = n.min(days.len());
    let slice = &days[days.len() - take..];
    Some(ClaudeLineEditsWindowSummary {
        lines_edited: slice.iter().map(|d| d.lines_edited).sum(),
        lines_added: slice.iter().map(|d| d.lines_added).sum(),
        lines_removed: slice.iter().map(|d| d.lines_removed).sum(),
        diff_count: slice.iter().map(|d| d.diff_count).sum(),
    })
}

#[derive(Default, Clone)]
struct DayAcc {
    lines: u64,
    diffs: u64,
    lines_added: u64,
    lines_removed: u64,
}

impl DayAcc {
    fn merge(&mut self, o: &DayAcc) {
        self.lines += o.lines;
        self.diffs += o.diffs;
        self.lines_added += o.lines_added;
        self.lines_removed += o.lines_removed;
    }
}

#[derive(Default)]
struct FileScanAcc {
    daily: HashMap<String, DayAcc>,
    events: u64,
}

impl FileScanAcc {
    fn merge(mut self, mut other: Self) -> Self {
        if other.daily.len() > self.daily.len() {
            std::mem::swap(&mut self.daily, &mut other.daily);
        }
        for (k, v) in other.daily {
            self.daily.entry(k).or_default().merge(&v);
        }
        self.events += other.events;
        self
    }
}

fn claude_code_base_dirs() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let env_raw = std::env::var("CLAUDE_CONFIG_DIR").unwrap_or_default();
    let env_trimmed = env_raw.trim();
    if !env_trimmed.is_empty() {
        for part in env_trimmed.split(',') {
            let p = PathBuf::from(part.trim());
            if p.is_dir() {
                let key = p.to_string_lossy().to_string();
                if seen.insert(key) {
                    out.push(p);
                }
            }
        }
        if !out.is_empty() {
            return out;
        }
    }

    if let Some(home) = dirs::home_dir() {
        for rel in [
            home.join(".config").join("claude"),
            crate::claude_config_dir::user_claude_dir(),
        ] {
            if rel.is_dir() {
                let key = rel.to_string_lossy().to_string();
                if seen.insert(key) {
                    out.push(rel);
                }
            }
        }
    }
    out
}

fn collect_jsonl_paths(projects_root: &Path, cap: usize, sink: &mut Vec<PathBuf>) {
    if !projects_root.is_dir() {
        return;
    }
    for entry in walkdir::WalkDir::new(projects_root)
        .into_iter()
        .filter_map(Result::ok)
    {
        if sink.len() >= cap {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            sink.push(p.to_path_buf());
        }
    }
}

fn pick_str<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a str> {
    for key in keys {
        if let Some(s) = obj.get(*key).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn is_file_edit_tool(name: &str) -> bool {
    matches!(
        name.trim().to_lowercase().as_str(),
        "edit"
            | "edit_file"
            | "write"
            | "write_file"
            | "multiedit"
            | "notebookedit"
            | "search_replace"
            | "strreplace"
            | "str_replace"
    )
}

fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    text.replace("\r\n", "\n").split('\n').map(String::from).collect()
}

/// 旧 API：返回新增+删除合计。仅在单元测试与未来"合计"导出场景使用，
/// 生产路径统一走 `count_edit_lines_split`，避免在调用方做无谓相加。
#[allow(dead_code)]
fn count_edit_lines(old_str: &str, new_str: &str) -> u64 {
    let (added, removed) = count_edit_lines_split(old_str, new_str);
    added + removed
}

/// 返回 (新增行数, 删除行数)；空 old + 非空 new 时仅 new 全数计入 added。
fn count_edit_lines_split(old_str: &str, new_str: &str) -> (u64, u64) {
    if old_str.is_empty() && !new_str.is_empty() {
        return (split_lines(new_str).len() as u64, 0);
    }
    let a = split_lines(old_str);
    let b = split_lines(new_str);
    let n = a.len();
    let m = b.len();
    if n == 0 && m == 0 {
        return (0, 0);
    }
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut added = 0u64;
    let mut removed = 0u64;
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n && j < m {
        if a[i] == b[j] {
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            removed += 1;
            i += 1;
        } else {
            added += 1;
            j += 1;
        }
    }
    removed += (n - i) as u64;
    added += (m - j) as u64;
    (added, removed)
}

/// 旧 API：返回新增+删除合计。生产路径统一走 `count_lines_from_tool_split`。
#[allow(dead_code)]
fn count_lines_from_tool(name: &str, input: &Value) -> Option<u64> {
    let (added, removed) = count_lines_from_tool_split(name, input)?;
    Some(added + removed)
}

/// 返回 (新增行数, 删除行数)；写入工具全数计入 added。
fn count_lines_from_tool_split(name: &str, input: &Value) -> Option<(u64, u64)> {
    if !is_file_edit_tool(name) {
        return None;
    }
    if pick_str(input, &["file_path", "path", "target_file"]).is_none() {
        return None;
    }
    let name_lower = name.trim().to_lowercase();
    match name_lower.as_str() {
        "write" | "write_file" => {
            let content = pick_str(
                input,
                &[
                    "content",
                    "contents",
                    "new_string",
                    "newString",
                    "text",
                    "data",
                ],
            )?;
            Some((split_lines(content).len() as u64, 0))
        }
        "multiedit" | "notebookedit" => {
            let edits = input.get("edits")?.as_array()?;
            let mut added = 0u64;
            let mut removed = 0u64;
            for edit in edits {
                let Some(row) = edit.as_object() else { continue };
                let row_val = Value::Object(row.clone());
                let old = pick_str(&row_val, &[
                    "old_string",
                    "oldString",
                    "old_text",
                    "oldText",
                ])
                .unwrap_or("");
                let new = pick_str(&row_val, &[
                    "new_string",
                    "newString",
                    "new_text",
                    "newText",
                ])
                .unwrap_or("");
                if old.is_empty() && new.is_empty() {
                    continue;
                }
                let (a, r) = count_edit_lines_split(old, new);
                added += a;
                removed += r;
            }
            if added == 0 && removed == 0 {
                None
            } else {
                Some((added, removed))
            }
        }
        _ => {
            let old = pick_str(
                input,
                &["old_string", "oldString", "old_text", "oldText"],
            )
            .unwrap_or("");
            let new = pick_str(
                input,
                &[
                    "new_string",
                    "newString",
                    "new_text",
                    "newText",
                    "replace_string",
                    "content",
                ],
            )
            .unwrap_or("");
            if old.is_empty() && new.is_empty() {
                return None;
            }
            Some(count_edit_lines_split(old, new))
        }
    }
}

fn extract_edits_from_content(content: &Value) -> (u64, u64, u64) {
    let Some(blocks) = content.as_array() else {
        return (0, 0, 0);
    };
    let mut added = 0u64;
    let mut removed = 0u64;
    let mut diffs = 0u64;
    for block in blocks {
        if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
            continue;
        }
        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let input = block.get("input").unwrap_or(&Value::Null);
        if let Some((a, r)) = count_lines_from_tool_split(name, input) {
            added += a;
            removed += r;
            diffs += 1;
        }
    }
    (added, removed, diffs)
}

#[inline]
fn line_maybe_edit_row(line: &str) -> bool {
    line.contains("tool_use") && line.contains("timestamp")
}

fn parse_edit_event(line: &str, min_day: NaiveDate) -> Option<(NaiveDate, DayAcc)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !line_maybe_edit_row(trimmed) {
        return None;
    }
    let v: Value = serde_json::from_str(trimmed).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return None;
    }
    let ts_str = v.get("timestamp").and_then(|t| t.as_str())?;
    let utc = chrono::DateTime::parse_from_rfc3339(ts_str)
        .ok()
        .map(|d| d.with_timezone(&Utc))
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S%.3fZ")
                .ok()
                .map(|naive| Utc.from_utc_datetime(&naive))
        })?;
    let day = utc.with_timezone(&Local).date_naive();
    if day < min_day {
        return None;
    }
    let content = v.get("message")?.get("content")?;
    let (added, removed, diffs) = extract_edits_from_content(content);
    if diffs == 0 {
        return None;
    }
    Some((
        day,
        DayAcc {
            lines: added + removed,
            diffs,
            lines_added: added,
            lines_removed: removed,
        },
    ))
}

fn scan_one_jsonl(fp: &Path, min_day: NaiveDate) -> FileScanAcc {
    let mut out = FileScanAcc::default();
    let f = match File::open(fp) {
        Ok(x) => x,
        Err(_) => return out,
    };
    let reader = BufReader::with_capacity(READ_BUF_CAP, f);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.len() > MAX_LINE_BYTES {
            continue;
        }
        if let Some((day, acc)) = parse_edit_event(&line, min_day) {
            let k = day.format("%Y-%m-%d").to_string();
            out.daily.entry(k).or_default().merge(&acc);
            out.events += 1;
        }
    }
    out
}

fn monday_of_week(d: NaiveDate) -> NaiveDate {
    let wd = d.weekday();
    let offset = match wd {
        Weekday::Mon => 0,
        Weekday::Tue => 1,
        Weekday::Wed => 2,
        Weekday::Thu => 3,
        Weekday::Fri => 4,
        Weekday::Sat => 5,
        Weekday::Sun => 6,
    };
    d - Duration::days(offset)
}

fn fill_day_window(anchor: NaiveDate, days: i64, source: &HashMap<String, DayAcc>) -> Vec<ClaudeLineEditsDayBucket> {
    let mut v = Vec::new();
    for i in (0..=days).rev() {
        let d = anchor - Duration::days(i);
        let k = d.format("%Y-%m-%d").to_string();
        let acc = source.get(&k).cloned().unwrap_or_default();
        v.push(ClaudeLineEditsDayBucket {
            date: k,
            lines_edited: acc.lines,
            diff_count: acc.diffs,
            lines_added: acc.lines_added,
            lines_removed: acc.lines_removed,
        });
    }
    v
}

fn month_label_from_key(month_key: &str) -> String {
    if let Ok(d) = NaiveDate::parse_from_str(&format!("{month_key}-01"), "%Y-%m-%d") {
        return format!("{}年{}月", d.year(), d.month());
    }
    month_key.to_string()
}

fn day_label_from_key(day_key: &str) -> String {
    if let Ok(d) = NaiveDate::parse_from_str(day_key, "%Y-%m-%d") {
        return format!("{}年{}月{}日", d.year(), d.month(), d.day());
    }
    day_key.to_string()
}

fn compute_most_active_month(daily: &HashMap<String, DayAcc>) -> Option<String> {
    let mut by_month: BTreeMap<String, u64> = BTreeMap::new();
    for (dk, acc) in daily {
        if acc.lines == 0 {
            continue;
        }
        let d = NaiveDate::parse_from_str(dk, "%Y-%m-%d").ok()?;
        let mk = d.format("%Y-%m").to_string();
        *by_month.entry(mk).or_default() += acc.lines;
    }
    by_month
        .into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| month_label_from_key(&k))
}

fn compute_most_active_day(daily: &HashMap<String, DayAcc>) -> Option<String> {
    daily
        .iter()
        .filter(|(_, acc)| acc.lines > 0)
        .max_by_key(|(_, acc)| acc.lines)
        .map(|(k, _)| day_label_from_key(k))
}

fn is_active(acc: &DayAcc) -> bool {
    acc.lines > 0 || acc.diffs > 0
}

fn compute_streaks(daily: &HashMap<String, DayAcc>, anchor: NaiveDate, span_days: i64) -> (u32, u32) {
    let mut longest = 0u32;
    let mut current_run = 0u32;
    for i in (0..=span_days).rev() {
        let d = anchor - Duration::days(i);
        let k = d.format("%Y-%m-%d").to_string();
        let active = daily.get(&k).map(is_active).unwrap_or(false);
        if active {
            current_run += 1;
            if current_run > longest {
                longest = current_run;
            }
        } else {
            current_run = 0;
        }
    }

    let mut current = 0u32;
    for i in 0..=span_days {
        let d = anchor - Duration::days(i);
        let k = d.format("%Y-%m-%d").to_string();
        let active = daily.get(&k).map(is_active).unwrap_or(false);
        if active {
            current += 1;
        } else if i == 0 {
            continue;
        } else {
            break;
        }
    }
    (longest, current)
}

fn build_snapshot_inner(project_path_filter: Option<&str>) -> Result<ClaudeLineEditsSnapshotResponse, String> {
    let bases = claude_code_base_dirs();
    if bases.is_empty() {
        return Ok(ClaudeLineEditsSnapshotResponse {
            total_lines_edited: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
            total_diff_count: 0,
            days: vec![],
            last_7_days: None,
            last_30_days: None,
            most_active_month: None,
            most_active_day: None,
            longest_streak_days: 0,
            current_streak_days: 0,
            scanned_files: 0,
            data_roots: vec![],
            hint: Some(
                "未找到 Claude Code 数据目录（~/.config/claude/projects 或 ~/.claude/projects）。"
                    .into(),
            ),
            events_parsed: 0,
        });
    }

    let encoded_project = project_path_filter
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|p| encoded_claude_project_dir(Path::new(p)))
        .transpose()?;

    let mut files: Vec<PathBuf> = Vec::new();
    for b in &bases {
        let projects = b.join("projects");
        if let Some(ref enc) = encoded_project {
            collect_jsonl_paths(
                &projects.join(enc),
                MAX_JSONL_FILES.saturating_sub(files.len()),
                &mut files,
            );
        } else {
            collect_jsonl_paths(
                &projects,
                MAX_JSONL_FILES.saturating_sub(files.len()),
                &mut files,
            );
        }
        if files.len() >= MAX_JSONL_FILES {
            break;
        }
    }

    let anchor = Local::now().date_naive();
    let min_day = anchor - Duration::days(HEATMAP_DAYS);
    let heatmap_start = monday_of_week(min_day);

    let merged = files
        .par_iter()
        .map(|fp| scan_one_jsonl(fp, heatmap_start))
        .reduce(FileScanAcc::default, FileScanAcc::merge);

    let daily = merged.daily;
    let events = merged.events;

    let days = fill_day_window(anchor, HEATMAP_DAYS, &daily);
    let total_lines_edited: u64 = days.iter().map(|d| d.lines_edited).sum();
    let total_lines_added: u64 = days.iter().map(|d| d.lines_added).sum();
    let total_lines_removed: u64 = days.iter().map(|d| d.lines_removed).sum();
    let total_diff_count: u64 = days.iter().map(|d| d.diff_count).sum();

    let (longest_streak_days, current_streak_days) =
        compute_streaks(&daily, anchor, HEATMAP_DAYS);

    let scope_hint = encoded_project.as_ref().map(|_| {
        format!(
            "仅统计当前仓库 JSONL（{}）",
            project_path_filter.unwrap_or("").trim()
        )
    });
    let hint = if events == 0 {
        Some(if encoded_project.is_some() {
            "该仓库暂无 Claude Code 编辑工具调用记录。".into()
        } else {
            "未解析到 Edit / Write 等文件编辑工具调用。请确认本机已有 Claude Code 会话 JSONL。"
                .into()
        })
    } else {
        scope_hint
    };

    let last_7_days = window_summary(&days, 7);
    let last_30_days = window_summary(&days, 30);
    Ok(ClaudeLineEditsSnapshotResponse {
        total_lines_edited,
        total_lines_added,
        total_lines_removed,
        total_diff_count,
        days,
        last_7_days,
        last_30_days,
        most_active_month: compute_most_active_month(&daily),
        most_active_day: compute_most_active_day(&daily),
        longest_streak_days,
        current_streak_days,
        scanned_files: files.len() as u32,
        data_roots: bases
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        hint,
        events_parsed: events,
    })
}

#[tauri::command]
pub async fn get_claude_code_line_edits_snapshot(
    project_path: Option<String>,
) -> Result<ClaudeLineEditsSnapshotResponse, String> {
    let filter = project_path.filter(|s| !s.trim().is_empty());
    tokio::task::spawn_blocking(move || build_snapshot_inner(filter.as_deref()))
        .await
        .map_err(|e| format!("代码编辑量统计任务异常: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn count_edit_lines_simple_replace() {
        assert_eq!(count_edit_lines("a\nb\nc", "a\nx\nc"), 2);
        assert_eq!(count_edit_lines("", "hello\nworld"), 2);
    }

    #[test]
    fn count_edit_lines_split_basic() {
        // 单行替换：b → x，新增 1 行，删除 1 行
        assert_eq!(count_edit_lines_split("a\nb\nc", "a\nx\nc"), (1, 1));
        // 旧 API 仍返回合计
        assert_eq!(count_edit_lines("a\nb\nc", "a\nx\nc"), 2);
    }

    #[test]
    fn count_edit_lines_split_empty_old() {
        // 空 old + 非空 new：全数计入 added
        assert_eq!(count_edit_lines_split("", "x\ny\nz"), (3, 0));
        assert_eq!(count_edit_lines("", "x\ny\nz"), 3);
    }

    #[test]
    fn count_edit_lines_split_empty_new() {
        // 非空 old + 空 new：全数计入 removed
        assert_eq!(count_edit_lines_split("x\ny", ""), (0, 2));
        assert_eq!(count_edit_lines("x\ny", ""), 2);
    }

    #[test]
    fn count_lines_from_tool_split_write_counts_added_only() {
        let input = json!({
            "file_path": "/tmp/a.ts",
            "content": "line1\nline2\nline3"
        });
        assert_eq!(
            count_lines_from_tool_split("Write", &input),
            Some((3, 0))
        );
        // 旧 API 行为不变
        assert_eq!(count_lines_from_tool("Write", &input), Some(3));
    }

    #[test]
    fn count_lines_from_tool_split_edit_splits_added_removed() {
        // old="foo" 单行；new="bar\nbaz" 两行 → 新增 2 行、删除 1 行
        let input = json!({
            "file_path": "src/a.ts",
            "old_string": "foo",
            "new_string": "bar\nbaz"
        });
        assert_eq!(
            count_lines_from_tool_split("Edit", &input),
            Some((2, 1))
        );
        assert_eq!(count_lines_from_tool("Edit", &input), Some(3));
    }

    #[test]
    fn fill_day_window_carries_split_lines() {
        let mut daily = HashMap::new();
        let d = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        daily.insert(
            d.format("%Y-%m-%d").to_string(),
            DayAcc {
                lines: 5,
                diffs: 2,
                lines_added: 4,
                lines_removed: 1,
            },
        );
        let anchor = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let days = fill_day_window(anchor, 0, &daily);
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].lines_edited, 5);
        assert_eq!(days[0].lines_added, 4);
        assert_eq!(days[0].lines_removed, 1);
        assert_eq!(days[0].diff_count, 2);
    }

    #[test]
    fn window_summary_takes_trailing_slice_and_sums() {
        // 模拟 fill_day_window 行为：按时间升序（最老 → 最新），每桶 1 行新增 + 0 删除 + 1 次编辑。
        // 最近 7 天 = 末尾 7 桶；最近 30 天 = 末尾 30 桶。
        let mut daily = HashMap::new();
        let anchor = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        for offset in 0..35i64 {
            let d = anchor - Duration::days(offset);
            daily.insert(
                d.format("%Y-%m-%d").to_string(),
                DayAcc {
                    lines: 1,
                    diffs: 1,
                    lines_added: 1,
                    lines_removed: 0,
                },
            );
        }
        let days = fill_day_window(anchor, 34, &daily);
        assert_eq!(days.len(), 35);
        // 数组末尾是"最近一天"——验证我们确实在末尾聚合，不是头部
        assert_eq!(days.last().unwrap().date, "2026-06-30");
        assert_eq!(days.first().unwrap().date, "2026-05-27");

        let last_7 = window_summary(&days, 7).expect("7 天窗口应非空");
        assert_eq!(last_7.lines_edited, 7);
        assert_eq!(last_7.lines_added, 7);
        assert_eq!(last_7.lines_removed, 0);
        assert_eq!(last_7.diff_count, 7);

        let last_30 = window_summary(&days, 30).expect("30 天窗口应非空");
        assert_eq!(last_30.lines_edited, 30);
        assert_eq!(last_30.lines_added, 30);
        assert_eq!(last_30.diff_count, 30);

        // 超出范围时取全部
        let last_999 = window_summary(&days, 999).expect("999 天窗口应非空");
        assert_eq!(last_999.lines_edited, 35);

        // 空数组 → None
        let empty: Vec<ClaudeLineEditsDayBucket> = vec![];
        assert!(window_summary(&empty, 7).is_none());
        // n = 0 也视为无数据
        assert!(window_summary(&days, 0).is_none());
    }

    #[test]
    fn count_lines_from_write_tool() {
        let input = json!({
            "file_path": "/tmp/a.ts",
            "content": "line1\nline2\nline3"
        });
        assert_eq!(count_lines_from_tool("Write", &input), Some(3));
    }

    #[test]
    fn parse_edit_event_from_assistant_jsonl() {
        let line = json!({
            "type": "assistant",
            "timestamp": "2026-04-23T10:00:00.000Z",
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {
                        "file_path": "src/a.ts",
                        "old_string": "foo",
                        "new_string": "bar\nbaz"
                    }
                }]
            }
        })
        .to_string();
        let min_day = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let (day, acc) = parse_edit_event(&line, min_day).unwrap();
        assert_eq!(day, NaiveDate::from_ymd_opt(2026, 4, 23).unwrap());
        assert_eq!(acc.diffs, 1);
        assert!(acc.lines >= 2);
    }

    #[test]
    fn streak_counts_consecutive_active_days() {
        let mut daily = HashMap::new();
        let anchor = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        for offset in [0i64, 1, 2, 4, 5] {
            let d = anchor - Duration::days(offset);
            daily.insert(
                d.format("%Y-%m-%d").to_string(),
                DayAcc {
                    lines: 10,
                    diffs: 1,
                    lines_added: 10,
                    lines_removed: 0,
                },
            );
        }
        let (longest, current) = compute_streaks(&daily, anchor, 10);
        assert_eq!(longest, 3);
        assert_eq!(current, 3);
    }
}
