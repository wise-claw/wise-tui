//! 从本机 Claude Code 项目 JSONL 汇总用量（路径与字段对齐 [ccusage](https://github.com/ryoppippi/ccusage)）。
//! 性能：并行按文件扫描、行级字符串预筛、仅保留最近 `RETENTION_DAYS` 的日历日；命令异步 `spawn_blocking` 避免阻塞运行时。

use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone, Utc, Weekday};
use rayon::prelude::*;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::claude_commands::disk_sessions::encoded_claude_project_dir;

const MAX_JSONL_FILES: usize = 5000;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const READ_BUF_CAP: usize = 256 * 1024;
/// 仅解析 / 聚合最近约 **半年**（按日回溯）内的 JSONL 用量行，更早记录跳过以控时控内存。
const RETENTION_DAYS: i64 = 184;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageBucket {
    pub sort_key: String,
    pub label: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    /// `cache_read / (input + cache_creation + cache_read)`，与 ccusage / Claude API 口径一致。
    pub cache_hit_rate: Option<f64>,
    pub cost_usd: f64,
    pub cost_entries: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageSeriesPayload {
    pub buckets: Vec<ClaudeUsageBucket>,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    /// 输出 token 总量；与 `total_tokens` 拆分展示，便于和"输入侧缓存命中率"分母区分。
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub cache_hit_rate: Option<f64>,
    pub total_cost_usd: f64,
    pub total_cost_entries: u64,
    pub period_caption: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageSnapshotResponse {
    pub day: ClaudeUsageSeriesPayload,
    pub week: ClaudeUsageSeriesPayload,
    pub month: ClaudeUsageSeriesPayload,
    pub scanned_files: u32,
    pub data_roots: Vec<String>,
    pub hint: Option<String>,
    pub events_parsed: u64,
}

#[derive(Default, Clone)]
struct Acc {
    input: u64,
    output: u64,
    cache_create: u64,
    cache_read: u64,
    cost_sum: f64,
    cost_entries: u64,
}

impl Acc {
    fn merge(&mut self, o: &Acc) {
        self.input += o.input;
        self.output += o.output;
        self.cache_create += o.cache_create;
        self.cache_read += o.cache_read;
        self.cost_sum += o.cost_sum;
        self.cost_entries += o.cost_entries;
    }

    /// 全量 token 合计：输入 + 输出 + 缓存写 + 缓存读。
    /// 注意：`cache_hit_rate` 的分母只覆盖输入侧（input + cache_create + cache_read），
    /// 不含 output —— 与 ccusage / Anthropic 计费口径一致。
    fn total_tokens(&self) -> u64 {
        self.input + self.output + self.cache_create + self.cache_read
    }
}

#[derive(Default)]
struct FileScanAcc {
    daily: HashMap<String, Acc>,
    lines_ok: u64,
}

impl FileScanAcc {
    fn merge(mut self, mut other: Self) -> Self {
        if other.daily.len() > self.daily.len() {
            std::mem::swap(&mut self.daily, &mut other.daily);
        }
        for (k, v) in other.daily {
            self.daily.entry(k).or_default().merge(&v);
        }
        self.lines_ok += other.lines_ok;
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

fn json_u64(v: &Value, key: &str) -> Option<u64> {
    let n = v.get(key)?;
    if let Some(u) = n.as_u64() {
        return Some(u);
    }
    if let Some(i) = n.as_i64() {
        return Some(i.max(0) as u64);
    }
    let f = n.as_f64()?;
    if f.is_finite() && f >= 0.0 {
        return Some(f as u64);
    }
    None
}

fn parse_cost_usd(v: &Value) -> Option<f64> {
    if let Some(c) = v.get("costUSD").and_then(|x| x.as_f64()) {
        return Some(c);
    }
    v.get("cost_usd").and_then(|x| x.as_f64())
}

#[inline]
fn line_maybe_usage_row(line: &str) -> bool {
    line.contains("assistant") && line.contains("input_tokens") && line.contains("timestamp")
}

fn parse_usage_event(line: &str, min_day: NaiveDate) -> Option<(NaiveDate, Acc)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !line_maybe_usage_row(trimmed) {
        return None;
    }
    let v: Value = serde_json::from_str(trimmed).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return None;
    }
    if v.get("isApiErrorMessage") == Some(&Value::Bool(true)) {
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
    let local = utc.with_timezone(&Local);
    let day = local.date_naive();
    if day < min_day {
        return None;
    }

    let usage = v.get("message")?.get("usage")?;
    let input = json_u64(usage, "input_tokens")?;
    let output = json_u64(usage, "output_tokens").unwrap_or(0);
    let cache_create = json_u64(usage, "cache_creation_input_tokens").unwrap_or(0);
    let cache_read = json_u64(usage, "cache_read_input_tokens").unwrap_or(0);

    let (cost_sum, cost_entries) = if let Some(c) = parse_cost_usd(&v) {
        if c.is_finite() {
            (c, 1u64)
        } else {
            (0.0, 0)
        }
    } else {
        (0.0, 0)
    };

    let acc = Acc {
        input,
        output,
        cache_create,
        cache_read,
        cost_sum,
        cost_entries,
    };
    Some((day, acc))
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
        if let Some((day, acc)) = parse_usage_event(&line, min_day) {
            let k = day.format("%Y-%m-%d").to_string();
            out.daily.entry(k).or_default().merge(&acc);
            out.lines_ok += 1;
        }
    }
    out
}

fn day_key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn week_sort_key(d: NaiveDate) -> String {
    let iso = d.iso_week();
    format!("{:04}-W{:02}", iso.year(), iso.week())
}

fn month_key(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}

fn label_for_day(d: NaiveDate) -> String {
    format!("{}/{}", d.month(), d.day())
}

/// 周视图：`YYYY-Www` →「2026年5月5日—11日」（该 ISO 周周一至周日的本地日历日，避免「月内第几周」歧义）。
fn label_for_week(sort_key: &str) -> String {
    let Some((y_str, w_str)) = sort_key.split_once("-W") else {
        return sort_key.to_string();
    };
    let Ok(iso_y) = y_str.parse::<i32>() else {
        return sort_key.to_string();
    };
    let Ok(iso_w) = w_str.parse::<u32>() else {
        return sort_key.to_string();
    };
    let Some(mon) = NaiveDate::from_isoywd_opt(iso_y, iso_w, Weekday::Mon) else {
        return sort_key.to_string();
    };
    let sun = mon + Duration::days(6);
    if mon.year() == sun.year() {
        if mon.month() == sun.month() {
            return format!(
                "{}年{}月{}日—{}日",
                mon.year(),
                mon.month(),
                mon.day(),
                sun.day()
            );
        }
        return format!(
            "{}年{}月{}日—{}月{}日",
            mon.year(),
            mon.month(),
            mon.day(),
            sun.month(),
            sun.day()
        );
    }
    format!(
        "{}年{}月{}日—{}年{}月{}日",
        mon.year(),
        mon.month(),
        mon.day(),
        sun.year(),
        sun.month(),
        sun.day()
    )
}

/// 月视图标签：仅接受 `YYYY-MM`；若误传入 ISO 周键 `YYYY-Www`，用该周周一所在「公历年月」展示（避免出现「年第*周」）。
fn label_for_month(sort_key: &str) -> String {
    if let Ok(d) = NaiveDate::parse_from_str(&format!("{sort_key}-01"), "%Y-%m-%d") {
        return format!("{}年{}月", d.year(), d.month());
    }
    if let Some((y_str, w_str)) = sort_key.split_once("-W") {
        if let (Ok(iso_y), Ok(iso_w)) = (y_str.parse::<i32>(), w_str.parse::<u32>()) {
            if let Some(mon) = NaiveDate::from_isoywd_opt(iso_y, iso_w, Weekday::Mon) {
                return format!("{}年{}月", mon.year(), mon.month());
            }
        }
    }
    sort_key.to_string()
}

fn rollup_to_weeks(daily: &HashMap<String, Acc>) -> BTreeMap<String, Acc> {
    let mut out: BTreeMap<String, Acc> = BTreeMap::new();
    for (dk, acc) in daily {
        let d =
            NaiveDate::parse_from_str(dk, "%Y-%m-%d").unwrap_or_else(|_| Local::now().date_naive());
        let wk = week_sort_key(d);
        out.entry(wk).or_default().merge(acc);
    }
    out
}

fn rollup_to_months(daily: &HashMap<String, Acc>) -> BTreeMap<String, Acc> {
    let mut out: BTreeMap<String, Acc> = BTreeMap::new();
    for (dk, acc) in daily {
        let d =
            NaiveDate::parse_from_str(dk, "%Y-%m-%d").unwrap_or_else(|_| Local::now().date_naive());
        let mk = month_key(d);
        out.entry(mk).or_default().merge(acc);
    }
    out
}

fn fill_day_window(
    anchor: NaiveDate,
    days: u32,
    source: &HashMap<String, Acc>,
) -> Vec<(String, Acc)> {
    let mut v = Vec::new();
    for i in (0..days).rev() {
        let d = anchor - Duration::days(i64::from(i));
        let k = day_key(d);
        let acc = source.get(&k).cloned().unwrap_or_default();
        v.push((k, acc));
    }
    v
}

fn distinct_week_keys_back(anchor: NaiveDate, max_days_back: i64, take: usize) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for i in 0..=max_days_back {
        let d = anchor - Duration::days(i);
        set.insert(week_sort_key(d));
    }
    set.into_iter().rev().take(take).rev().collect()
}

fn distinct_month_keys_back(anchor: NaiveDate, max_days_back: i64, take: usize) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for i in 0..=max_days_back {
        let d = anchor - Duration::days(i);
        set.insert(month_key(d));
    }
    set.into_iter().rev().take(take).rev().collect()
}

/// 输入侧缓存命中率：`cache_read / (input + cache_creation + cache_read)`。
fn cache_hit_rate(input: u64, cache_create: u64, cache_read: u64) -> Option<f64> {
    let denom = input.saturating_add(cache_create).saturating_add(cache_read);
    if denom == 0 {
        return None;
    }
    Some(cache_read as f64 / denom as f64)
}

fn acc_to_bucket(sort_key: String, label: String, acc: Acc) -> ClaudeUsageBucket {
    let total = acc.total_tokens();
    ClaudeUsageBucket {
        label,
        cost_usd: acc.cost_sum,
        cost_entries: acc.cost_entries,
        input_tokens: acc.input,
        output_tokens: acc.output,
        cache_creation_tokens: acc.cache_create,
        cache_read_tokens: acc.cache_read,
        total_tokens: total,
        cache_hit_rate: cache_hit_rate(acc.input, acc.cache_create, acc.cache_read),
        sort_key,
    }
}

struct SeriesTotals {
    total_tokens: u64,
    total_input: u64,
    total_output: u64,
    total_cache_create: u64,
    total_cache_read: u64,
    total_cost: f64,
    total_cost_entries: u64,
}

fn series_totals(buckets: &[ClaudeUsageBucket]) -> SeriesTotals {
    let mut out = SeriesTotals {
        total_tokens: 0,
        total_input: 0,
        total_output: 0,
        total_cache_create: 0,
        total_cache_read: 0,
        total_cost: 0.0,
        total_cost_entries: 0,
    };
    for b in buckets {
        out.total_tokens += b.total_tokens;
        out.total_input += b.input_tokens;
        out.total_output += b.output_tokens;
        out.total_cache_create += b.cache_creation_tokens;
        out.total_cache_read += b.cache_read_tokens;
        out.total_cost += b.cost_usd;
        out.total_cost_entries += b.cost_entries;
    }
    out
}

fn build_series_payload(
    buckets: Vec<ClaudeUsageBucket>,
    period_caption: String,
) -> ClaudeUsageSeriesPayload {
    let t = series_totals(&buckets);
    ClaudeUsageSeriesPayload {
        buckets,
        total_tokens: t.total_tokens,
        total_input_tokens: t.total_input,
        total_output_tokens: t.total_output,
        total_cache_creation_tokens: t.total_cache_create,
        total_cache_read_tokens: t.total_cache_read,
        cache_hit_rate: cache_hit_rate(t.total_input, t.total_cache_create, t.total_cache_read),
        total_cost_usd: t.total_cost,
        total_cost_entries: t.total_cost_entries,
        period_caption,
    }
}

fn build_snapshot_inner(project_path_filter: Option<&str>) -> Result<ClaudeUsageSnapshotResponse, String> {
    let bases = claude_code_base_dirs();
    if bases.is_empty() {
        let empty = || build_series_payload(vec![], String::new());
        return Ok(ClaudeUsageSnapshotResponse {
            day: empty(),
            week: empty(),
            month: empty(),
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
            let scoped = projects.join(enc);
            collect_jsonl_paths(
                &scoped,
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
    let min_day = anchor - Duration::days(RETENTION_DAYS);

    let merged = files
        .par_iter()
        .map(|fp| scan_one_jsonl(fp, min_day))
        .reduce(FileScanAcc::default, FileScanAcc::merge);

    let daily = merged.daily;
    let lines_ok = merged.lines_ok;

    let day_buckets = {
        let rows = fill_day_window(anchor, 30, &daily);
        rows.into_iter()
            .map(|(k, acc)| {
                let d = NaiveDate::parse_from_str(&k, "%Y-%m-%d").unwrap_or(anchor);
                acc_to_bucket(k.clone(), label_for_day(d), acc)
            })
            .collect::<Vec<_>>()
    };

    let week_buckets = {
        let weeks_map = rollup_to_weeks(&daily);
        let keys = distinct_week_keys_back(anchor, RETENTION_DAYS, 12);
        keys.into_iter()
            .map(|k| {
                let acc = weeks_map.get(&k).cloned().unwrap_or_default();
                acc_to_bucket(k.clone(), label_for_week(&k), acc)
            })
            .collect::<Vec<_>>()
    };

    let month_buckets = {
        let months_map = rollup_to_months(&daily);
        let keys = distinct_month_keys_back(anchor, RETENTION_DAYS, 12);
        keys.into_iter()
            .map(|k| {
                let acc = months_map.get(&k).cloned().unwrap_or_default();
                acc_to_bucket(k.clone(), label_for_month(&k), acc)
            })
            .collect::<Vec<_>>()
    };

    let day = build_series_payload(day_buckets, "近 30 天".into());
    let week = build_series_payload(week_buckets, "近 12 周".into());
    let month = build_series_payload(month_buckets, "近半年".into());

    let cost_entries_day = series_totals(&day.buckets).total_cost_entries;
    let scope_hint = encoded_project.as_ref().map(|_| {
        format!(
            "仅统计当前仓库 JSONL（{}）",
            project_path_filter.unwrap_or("").trim()
        )
    });
    let hint = if lines_ok == 0 {
        Some(if encoded_project.is_some() {
            "该仓库暂无 Claude Code 会话 JSONL，或未解析到 assistant 用量行。".into()
        } else {
            "未解析到 assistant 用量行。请确认本机已用 Claude Code 产生会话 JSONL。".into()
        })
    } else if cost_entries_day == 0 {
        Some(format!(
            "{}{}",
            scope_hint.as_deref().map(|s| format!("{s} · ")).unwrap_or_default(),
            "当前 JSONL 无 costUSD 字段；费用为 0。完整费用估算可使用终端：npx ccusage@latest（本面板仅统计近半年）。"
        ))
    } else {
        scope_hint
    };

    let data_roots: Vec<String> = bases
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    Ok(ClaudeUsageSnapshotResponse {
        day,
        week,
        month,
        scanned_files: files.len() as u32,
        data_roots,
        hint,
        events_parsed: lines_ok,
    })
}

#[tauri::command]
pub async fn get_claude_code_usage_snapshot(
    project_path: Option<String>,
) -> Result<ClaudeUsageSnapshotResponse, String> {
    let filter = project_path.filter(|s| !s.trim().is_empty());
    tokio::task::spawn_blocking(move || build_snapshot_inner(filter.as_deref()))
        .await
        .map_err(|e| format!("用量统计任务异常: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_hit_rate_matches_ccusage_formula() {
        assert_eq!(cache_hit_rate(0, 0, 0), None);
        assert_eq!(cache_hit_rate(100, 0, 0), Some(0.0));
        assert_eq!(cache_hit_rate(10, 5, 85), Some(0.85));
        let r = cache_hit_rate(11_042, 128_295, 2_147_336).unwrap();
        assert!((r - 0.939).abs() < 0.001);
    }

    #[test]
    fn bucket_exposes_hit_rate_from_acc() {
        let b = acc_to_bucket(
            "2026-01-01".into(),
            "1/1".into(),
            Acc {
                input: 100,
                cache_create: 50,
                cache_read: 850,
                ..Default::default()
            },
        );
        assert_eq!(b.cache_hit_rate, Some(0.85));
    }

    #[test]
    fn series_payload_aggregates_output_tokens() {
        // 模拟合计 2800M 的口径：input 384 + output 27 + cache_create 9 + cache_read 2380 = 2800；
        // 命中率分母（输入侧）= 384 + 9 + 2380 = 2773，与前端展示一致。
        let buckets = vec![
            acc_to_bucket(
                "2026-01-01".into(),
                "1/1".into(),
                Acc {
                    input: 200,
                    output: 15,
                    cache_create: 5,
                    cache_read: 1200,
                    ..Default::default()
                },
            ),
            acc_to_bucket(
                "2026-01-02".into(),
                "1/2".into(),
                Acc {
                    input: 184,
                    output: 12,
                    cache_create: 4,
                    cache_read: 1180,
                    ..Default::default()
                },
            ),
        ];

        let payload = build_series_payload(buckets, "近 30 天".into());

        assert_eq!(payload.total_tokens, 2800);
        assert_eq!(payload.total_input_tokens, 384);
        assert_eq!(payload.total_output_tokens, 27);
        assert_eq!(payload.total_cache_creation_tokens, 9);
        assert_eq!(payload.total_cache_read_tokens, 2380);
        // cache_read / (input + cache_creation + cache_read) ≈ 2380 / 2773 ≈ 0.8584
        let rate = payload.cache_hit_rate.expect("hit rate present");
        assert!((rate - 0.8584).abs() < 0.001, "rate={rate}");
        assert_eq!(payload.period_caption, "近 30 天");
    }
}
