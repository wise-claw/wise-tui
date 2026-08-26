//! Chrome DevTools Protocol (CDP) monitor for AI 报错监控.
//!
//! Modes:
//! - `launch`：独立 Chrome profile + 远程调试口（默认，与日常浏览器隔离）
//! - `attach`：附着已开启 `--remote-debugging-port` 的既有 Chrome；停止时不断开浏览器进程

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const EVENT_ISSUE: &str = "chrome-devtools-issue";
const ACTIVE_PORT_FILE: &str = "DevToolsActivePort";
const ATTACH_TIMEOUT: Duration = Duration::from_secs(12);
const ATTACH_POLL: Duration = Duration::from_millis(200);
const DEFAULT_ATTACH_DEBUG_PORT: u16 = 9222;
/// 注入脚本通过该 binding 把性能指标/长任务回传 CDP。
const WISE_BINDING_NAME: &str = "__wiseMonitorReport";
/// 请求耗时超过该阈值（毫秒）即上报 slow-request。
const SLOW_REQUEST_REPORT_MS: u64 = 3_000;
/// 长任务超过该阈值（毫秒）即上报 long-task。
const LONG_TASK_REPORT_MS: u64 = 500;

/// 注入到页面主世界：Web Vitals / 长任务 / 加载时序 / 用户操作轨迹 / 白屏。
/// 经 `Runtime.addBinding` 回传 JSON。
/// 请与 browser-extensions/wise-page-monitor/inject-vitals.js 保持同步。
const PAGE_INJECTION_SCRIPT: &str = r###"(function () {
  try {
    if (window.__wiseVitalsInstalled) return;
    window.__wiseVitalsInstalled = true;
    var report = function (payload) {
      try { window.__wiseMonitorReport(JSON.stringify(payload)); } catch (e) {}
    };
    var round = function (n) { return Math.round(n); };
    var pageUrl = function () {
      try { return String(location.href || ""); } catch (e) { return ""; }
    };
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.responseStart > 0) {
        report({ kind: "vitals", metric: "ttfb", value: round(nav.responseStart) });
      }
      var paintObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.name === "first-contentful-paint") {
            report({ kind: "vitals", metric: "fcp", value: round(e.startTime) });
          }
        }
      });
      paintObs.observe({ type: "paint", buffered: true });
    } catch (e) {}
    try {
      var lcpSeen = null;
      var lcpObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var e = entries[entries.length - 1];
        if (e && e.startTime !== lcpSeen) {
          lcpSeen = e.startTime;
          report({ kind: "vitals", metric: "lcp", value: round(e.startTime) });
        }
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) {}
    try {
      var clsValue = 0;
      var clsTimer = null;
      var clsReport = function () {
        clsTimer = null;
        report({ kind: "vitals", metric: "cls", value: +clsValue.toFixed(3) });
      };
      var clsObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (!e.hadRecentInput) clsValue += e.value;
        }
        if (clsTimer == null) clsTimer = setTimeout(clsReport, 1000);
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      window.addEventListener("pagehide", function () {
        if (clsValue > 0) clsReport();
      });
    } catch (e) {}
    try {
      var inpMax = 0;
      var inpObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var d = list.getEntries()[i].duration;
          if (d > inpMax) inpMax = d;
        }
      });
      inpObs.observe({ type: "event", durationThreshold: 100, buffered: true });
      window.addEventListener("pagehide", function () {
        if (inpMax > 0) report({ kind: "vitals", metric: "inp", value: round(inpMax) });
      });
    } catch (e) {}
    try {
      var ltObs = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.duration >= 500) {
            var src = "";
            if (e.attribution && e.attribution[0]) src = e.attribution[0].containerSrc || "";
            report({ kind: "long-task", value: round(e.duration), url: src });
          }
        }
      });
      ltObs.observe({ type: "longtask", buffered: true });
    } catch (e) {}
    try {
      var timingSent = {};
      var sendTiming = function () {
        try {
          var navT = performance.getEntriesByType("navigation")[0];
          if (!navT) return;
          if (navT.domContentLoadedEventEnd > 0 && !timingSent.dcl) {
            timingSent.dcl = true;
            report({ kind: "timing", metric: "dcl", value: round(navT.domContentLoadedEventEnd), url: pageUrl() });
          }
          if (navT.loadEventEnd > 0 && !timingSent.load) {
            timingSent.load = true;
            report({ kind: "timing", metric: "load", value: round(navT.loadEventEnd), url: pageUrl() });
          }
        } catch (err) {}
      };
      sendTiming();
      if (document.readyState !== "complete") {
        window.addEventListener("load", function () { setTimeout(sendTiming, 0); });
      }
    } catch (e) {}
    try {
      var lastClickAt = 0;
      var describe = function (el) {
        if (!el || !el.tagName) return "";
        var tag = String(el.tagName || "").toLowerCase();
        var id = el.id ? "#" + String(el.id).slice(0, 40) : "";
        var name = "";
        try { name = el.getAttribute("name") || el.getAttribute("aria-label") || ""; } catch (err) {}
        var namePart = name ? "[name=" + String(name).slice(0, 40) + "]" : "";
        var txt = "";
        try { txt = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32); } catch (err) {}
        var txtPart = txt ? (" '" + txt + "'") : "";
        return (tag + id + namePart + txtPart).slice(0, 120);
      };
      document.addEventListener("click", function (ev) {
        var now = Date.now();
        if (now - lastClickAt < 800) return;
        lastClickAt = now;
        report({ kind: "breadcrumb", metric: "click", message: describe(ev.target) || "click", url: pageUrl() });
      }, true);
      document.addEventListener("change", function (ev) {
        var t = ev.target;
        if (!t || !t.tagName) return;
        var tag = String(t.tagName).toLowerCase();
        if (tag !== "input" && tag !== "select" && tag !== "textarea") return;
        var type = "";
        try { type = String(t.type || "").toLowerCase(); } catch (err) {}
        var label = describe(t) || tag;
        if (type === "password") label += " (password)";
        report({ kind: "breadcrumb", metric: "input", message: label, url: pageUrl() });
      }, true);
      document.addEventListener("submit", function (ev) {
        report({ kind: "breadcrumb", metric: "submit", message: describe(ev.target) || "form", url: pageUrl() });
      }, true);
      var onNav = function (how) {
        report({ kind: "breadcrumb", metric: "navigate", message: how + " " + pageUrl(), url: pageUrl() });
      };
      var wrapHist = function (name) {
        try {
          var orig = history[name];
          if (typeof orig !== "function") return;
          history[name] = function () {
            var ret = orig.apply(this, arguments);
            onNav(name);
            return ret;
          };
        } catch (err) {}
      };
      wrapHist("pushState");
      wrapHist("replaceState");
      window.addEventListener("popstate", function () { onNav("popstate"); });
      window.addEventListener("hashchange", function () { onNav("hashchange"); });
    } catch (e) {}
    try {
      var blankSent = false;
      var hadContent = false;
      var textLen = function () {
        try {
          var body = document.body;
          if (!body) return 0;
          return String(body.innerText || body.textContent || "").replace(/\s+/g, " ").trim().length;
        } catch (err) { return 0; }
      };
      var visibleCount = function () {
        try {
          if (!document.body) return 0;
          var nodes = document.body.getElementsByTagName("*");
          var n = 0;
          var max = Math.min(nodes.length, 500);
          for (var i = 0; i < max; i++) {
            var el = nodes[i];
            var tag = String(el.tagName || "");
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "META" || tag === "NOSCRIPT") continue;
            var r = el.getBoundingClientRect();
            if (r.width >= 8 && r.height >= 8) n++;
          }
          return n;
        } catch (err) { return 0; }
      };
      var hasSizedMedia = function () {
        try {
          var media = document.querySelectorAll("canvas, video, svg, img, iframe");
          for (var i = 0; i < media.length; i++) {
            var r = media[i].getBoundingClientRect();
            if (r.width >= 40 && r.height >= 40) return true;
          }
        } catch (err) {}
        return false;
      };
      var checkBlank = function (finalCheck) {
        if (blankSent || hadContent) return;
        try {
          var href = pageUrl();
          if (!href || href.indexOf("about:") === 0) return;
          var chars = textLen();
          var vis = visibleCount();
          if (hasSizedMedia() || chars >= 40 || vis >= 8) {
            hadContent = true;
            return;
          }
          if (!finalCheck) return;
          blankSent = true;
          report({
            kind: "blank-screen",
            message: chars + " chars, " + vis + " visible nodes",
            value: chars,
            url: href
          });
        } catch (err) {}
      };
      var startBlankWatch = function () {
        setTimeout(function () { checkBlank(false); }, 2500);
        setTimeout(function () { checkBlank(true); }, 6000);
      };
      if (document.readyState === "complete") startBlankWatch();
      else window.addEventListener("load", startBlankWatch);
    } catch (e) {}
  } catch (e) {}
})();"###;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeDevtoolsIssue {
    pub session_id: String,
    /// `page-error` | `console-error` | `console-warning` | `network-http` | `network-failed`
    /// `page-crash` | `page-vitals` | `long-task` | `slow-request`
    /// `breadcrumb` | `page-timing` | `blank-screen` | `vitals-alert` | `synthetic-check`
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_type: Option<String>,
    /// 白屏等证据图的本机绝对路径（`~/.wise/page-monitor-evidence/*.jpg`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VitalsThresholds {
    #[serde(default = "default_lcp_ms")]
    pub lcp_ms: u64,
    #[serde(default = "default_cls")]
    pub cls: f64,
    #[serde(default = "default_inp_ms")]
    pub inp_ms: u64,
}

fn default_lcp_ms() -> u64 {
    4000
}
fn default_cls() -> f64 {
    0.25
}
fn default_inp_ms() -> u64 {
    500
}

impl Default for VitalsThresholds {
    fn default() -> Self {
        Self {
            lcp_ms: default_lcp_ms(),
            cls: default_cls(),
            inp_ms: default_inp_ms(),
        }
    }
}

pub fn normalize_vitals_thresholds(raw: Option<VitalsThresholds>) -> VitalsThresholds {
    let t = raw.unwrap_or_default();
    VitalsThresholds {
        lcp_ms: t.lcp_ms.clamp(500, 60_000),
        cls: if t.cls.is_finite() {
            t.cls.clamp(0.01, 2.0)
        } else {
            default_cls()
        },
        inp_ms: t.inp_ms.clamp(50, 10_000),
    }
}

/// 0 表示关闭；其它值限制在 10–600 秒。缺省 30 秒。
pub fn normalize_synthetic_interval_secs(raw: Option<u64>) -> u64 {
    match raw.unwrap_or(30) {
        0 => 0,
        n => n.clamp(10, 600),
    }
}

const SOURCEMAP_FETCH_TIMEOUT: Duration = Duration::from_millis(800);
const SOURCEMAP_MAX_BYTES: usize = 2_000_000;
const SOURCEMAP_CACHE_CAP: usize = 48;

fn sourcemap_bytes_cache() -> &'static Mutex<HashMap<String, Option<Vec<u8>>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Vec<u8>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn candidate_map_urls(script_url: &str) -> Vec<String> {
    let trimmed = script_url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Vec::new();
    }
    let no_hash = trimmed.split('#').next().unwrap_or(trimmed);
    let base = no_hash.split('?').next().unwrap_or(no_hash);
    if base.is_empty() || base.ends_with(".map") {
        return Vec::new();
    }
    let mut out = vec![format!("{base}.map")];
    if let Some(query) = no_hash.strip_prefix(base).filter(|s| s.starts_with('?')) {
        let with_query = format!("{base}.map{query}");
        if with_query != out[0] {
            out.push(with_query);
        }
    }
    out
}

fn lookup_orig_in_map_bytes(bytes: &[u8], line: u32, column: u32) -> Option<String> {
    let sm = sourcemap::SourceMap::from_slice(bytes).ok()?;
    let token = sm.lookup_token(line, column)?;
    let src = token.get_source()?.trim();
    if src.is_empty() {
        return None;
    }
    let src_line = token.get_src_line().saturating_add(1);
    let src_col = token.get_src_col().saturating_add(1);
    Some(format!("{src}:{src_line}:{src_col}"))
}

async fn fetch_map_bytes(map_url: &str) -> Option<Vec<u8>> {
    {
        let cache = sourcemap_bytes_cache().lock().ok()?;
        if let Some(hit) = cache.get(map_url) {
            return hit.clone();
        }
    }
    let client = reqwest::Client::builder()
        .timeout(SOURCEMAP_FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .ok()?;
    let bytes = match client.get(map_url).send().await {
        Ok(resp) if resp.status().is_success() => resp.bytes().await.ok().map(|b| b.to_vec()),
        _ => None,
    };
    let bytes = bytes.filter(|b| !b.is_empty() && b.len() <= SOURCEMAP_MAX_BYTES);
    if let Ok(mut cache) = sourcemap_bytes_cache().lock() {
        if cache.len() >= SOURCEMAP_CACHE_CAP {
            cache.clear();
        }
        cache.insert(map_url.to_string(), bytes.clone());
    }
    bytes
}

/// 尝试 `{url}.map` 把 CDP 0-based 行列还原为源码位置（`src/App.tsx:12:4`）。
pub async fn resolve_orig_source_location(url: &str, line: u32, column: u32) -> Option<String> {
    for map_url in candidate_map_urls(url) {
        let Some(bytes) = fetch_map_bytes(&map_url).await else {
            continue;
        };
        if let Some(orig) = lookup_orig_in_map_bytes(&bytes, line, column) {
            return Some(orig);
        }
    }
    None
}

async fn append_orig_location(mut message: String, script_url: &str, line: u32, column: u32) -> String {
    if script_url.is_empty() || message.contains("| orig ") {
        return message;
    }
    if let Some(orig) = resolve_orig_source_location(script_url, line, column).await {
        message = format!("{message} | orig {orig}");
    }
    message
}

pub async fn probe_synthetic_url(url: &str) -> Result<u16, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .header("User-Agent", "Wise-PageMonitor/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().as_u16())
}

fn synthetic_check_issue(
    session_id: &str,
    url: &str,
    result: Result<u16, String>,
) -> Option<ChromeDevtoolsIssue> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    let (message, status) = match result {
        Ok(code) if code < 400 => return None,
        Ok(code) => (format!("GET {url} {code}"), Some(code)),
        Err(err) => {
            let err = err.replace('\n', " ");
            (
                format!("Chrome synthetic check error: GET {url} failed: {err}"),
                None,
            )
        }
    };
    Some(ChromeDevtoolsIssue {
        session_id: session_id.to_string(),
        kind: "synthetic-check".into(),
        message,
        url: Some(url.into()),
        method: Some("GET".into()),
        status,
        metric: None,
        value: None,
        duration_ms: None,
        resource_type: None,
        evidence_path: None,
    })
}

async fn run_synthetic_loop(
    app: AppHandle,
    session_id: String,
    url: String,
    interval_secs: u64,
    mut cancel_rx: watch::Receiver<bool>,
) {
    if interval_secs == 0 {
        loop {
            if cancel_rx.changed().await.is_err() || *cancel_rx.borrow() {
                break;
            }
        }
        return;
    }
    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await;
    loop {
        tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_err() || *cancel_rx.borrow() {
                    break;
                }
            }
            _ = ticker.tick() => {
                let result = probe_synthetic_url(&url).await;
                if let Some(issue) = synthetic_check_issue(&session_id, &url, result) {
                    emit_issue(&app, issue);
                }
            }
        }
    }
}

enum MonitorCmd {
    Reload,
}

struct MonitorSession {
    child: Option<Child>,
    cancel_tx: watch::Sender<bool>,
    cmd_tx: Option<mpsc::UnboundedSender<MonitorCmd>>,
    /// Extension mode has no CDP loop; reload goes through the localhost bridge.
    extension_mode: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Default)]
pub struct ChromeDevtoolsMonitorState {
    sessions: Mutex<HashMap<String, MonitorSession>>,
}

fn wise_chrome_profile_dir(session_id: &str) -> Result<PathBuf, String> {
    let safe: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = crate::wise_paths::wise_dir()
        .map_err(|e| format!("无法解析 ~/.wise：{e}"))?
        .join("chrome-devtools-monitor")
        .join(if safe.is_empty() { "default".into() } else { safe });
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 Chrome 监控配置目录：{e}"))?;
    Ok(dir)
}

fn find_chrome_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.extend([
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            PathBuf::from("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
        ]);
        if let Some(home) = dirs::home_dir() {
            candidates.push(
                home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            );
        }
    }
    #[cfg(target_os = "linux")]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "brave-browser",
        ] {
            if let Ok(output) = Command::new("which").arg(name).output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        candidates.push(PathBuf::from(path));
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program = std::env::var("PROGRAMFILES").unwrap_or_default();
        let program_x86 = std::env::var("PROGRAMFILES(X86)").unwrap_or_default();
        for root in [local, program, program_x86] {
            if root.is_empty() {
                continue;
            }
            candidates.push(PathBuf::from(&root).join(r"Google\Chrome\Application\chrome.exe"));
            candidates.push(PathBuf::from(&root).join(r"Microsoft\Edge\Application\msedge.exe"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn launch_chrome(profile: &Path, url: &str) -> Result<Child, String> {
    let chrome = find_chrome_binary().ok_or_else(|| {
        "未找到 Chrome / Chromium / Edge。请安装 Google Chrome 以启用 DevTools 监控。".to_string()
    })?;
    let _ = fs::remove_file(profile.join(ACTIVE_PORT_FILE));
    Command::new(&chrome)
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--remote-debugging-port=0")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-default-apps")
        .arg("--disable-popup-blocking")
        .arg("--disable-background-networking")
        .arg("--disable-features=Translate,MediaRouter")
        .arg("--new-window")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 Chrome 失败（{}）：{e}", chrome.display()))
}

fn read_devtools_active_port(profile: &Path) -> Option<(u16, String)> {
    let text = fs::read_to_string(profile.join(ACTIVE_PORT_FILE)).ok()?;
    let mut lines = text.lines();
    let port: u16 = lines.next()?.trim().parse().ok()?;
    let path = lines.next().unwrap_or("/devtools/browser").trim().to_string();
    Some((port, path))
}

async fn wait_for_devtools_port(profile: &Path) -> Result<(u16, String), String> {
    let started = std::time::Instant::now();
    loop {
        if let Some(pair) = read_devtools_active_port(profile) {
            return Ok(pair);
        }
        if started.elapsed() > ATTACH_TIMEOUT {
            return Err("等待 Chrome DevTools 调试端口超时".to_string());
        }
        tokio::time::sleep(ATTACH_POLL).await;
    }
}

fn normalize_url_for_match(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_hash = trimmed.split('#').next().unwrap_or(trimmed);
    without_hash.trim_end_matches('/').to_string()
}

/// Higher score = better match for attaching to an existing tab.
fn score_page_url_match(page_url: &str, preferred: &str) -> i32 {
    let page = normalize_url_for_match(page_url);
    let want = normalize_url_for_match(preferred);
    if page.is_empty() || want.is_empty() {
        return 0;
    }
    if page == want {
        return 100;
    }
    if page.starts_with(&want) || want.starts_with(&page) {
        return 60;
    }
    let page_origin = page.split('/').take(3).collect::<Vec<_>>().join("/");
    let want_origin = want.split('/').take(3).collect::<Vec<_>>().join("/");
    if !page_origin.is_empty() && page_origin == want_origin {
        return 30;
    }
    0
}

fn pick_best_page_ws(pages: &[Value], preferred_url: &str) -> Option<(String, i32)> {
    let mut best: Option<(String, i32)> = None;
    for item in pages {
        let ty = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if ty != "page" {
            continue;
        }
        let Some(ws) = item
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let page_url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let score = if preferred_url.trim().is_empty() {
            1
        } else {
            score_page_url_match(page_url, preferred_url)
        };
        match &best {
            None => best = Some((ws.to_string(), score)),
            Some((_, best_score)) if score > *best_score => {
                best = Some((ws.to_string(), score));
            }
            _ => {}
        }
    }
    best
}

async fn http_json_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

async fn probe_debug_port(port: u16) -> Result<(), String> {
    let client = http_json_client().await?;
    let version_url = format!("http://127.0.0.1:{port}/json/version");
    let resp = client.get(&version_url).send().await.map_err(|e| {
        format!(
            "无法连接本机 Chrome 调试端口 {port}：{e}。请先用 `--remote-debugging-port={port}` 启动 Chrome。"
        )
    })?;
    if !resp.status().is_success() {
        return Err(format!(
            "Chrome 调试端口 {port} 响应异常（HTTP {}）",
            resp.status()
        ));
    }
    Ok(())
}

async fn list_targets(port: u16) -> Result<Vec<Value>, String> {
    let client = http_json_client().await?;
    let list_url = format!("http://127.0.0.1:{port}/json/list");
    let pages: Value = client
        .get(&list_url)
        .send()
        .await
        .map_err(|e| format!("读取 Chrome target 列表失败：{e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Chrome target 列表失败：{e}"))?;
    Ok(pages.as_array().cloned().unwrap_or_default())
}

/// Minimal URL encoding for query string (Chrome /json/new).
fn urlencoding_minimal(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() * 3);
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' | b'/' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{b:02X}"));
            }
        }
    }
    out
}

async fn create_page_target(port: u16, url: &str) -> Result<String, String> {
    let client = http_json_client().await?;
    let new_url = format!(
        "http://127.0.0.1:{port}/json/new?{}",
        urlencoding_minimal(url)
    );
    let resp = match client.put(&new_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(_) | Err(_) => client
            .get(&new_url)
            .send()
            .await
            .map_err(|e| format!("在已有 Chrome 中打开新标签失败：{e}"))?,
    };
    if !resp.status().is_success() {
        return Err(format!(
            "在已有 Chrome 中打开新标签失败（HTTP {}）",
            resp.status()
        ));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析新建标签响应失败：{e}"))?;
    body.get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "新建标签未返回 webSocketDebuggerUrl".to_string())
}

async fn fallback_any_ws(port: u16, pages: &[Value]) -> Result<String, String> {
    if let Some((ws, _)) = pick_best_page_ws(pages, "") {
        return Ok(ws);
    }
    for item in pages {
        if let Some(ws) = item
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Ok(ws.to_string());
        }
    }
    let client = http_json_client().await?;
    let version_url = format!("http://127.0.0.1:{port}/json/version");
    let version: Value = client
        .get(&version_url)
        .send()
        .await
        .map_err(|e| format!("读取 Chrome version 失败：{e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Chrome version 失败：{e}"))?;
    version
        .get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Chrome 未返回 webSocketDebuggerUrl".to_string())
}

/// Resolve a page WebSocket debugger URL. Returns `(ws_url, should_navigate)`.
async fn resolve_page_ws_url(port: u16, preferred_url: &str) -> Result<(String, bool), String> {
    let pages = list_targets(port).await?;
    if !preferred_url.trim().is_empty() {
        if let Some((ws, score)) = pick_best_page_ws(&pages, preferred_url) {
            if score >= 30 {
                // Matched existing tab — attach without navigate.
                return Ok((ws, false));
            }
            if score > 0 {
                return Ok((ws, true));
            }
        }
        match create_page_target(port, preferred_url).await {
            Ok(ws) => return Ok((ws, false)),
            Err(create_err) => {
                let ws = fallback_any_ws(port, &pages)
                    .await
                    .map_err(|e| format!("{e}；另：{create_err}"))?;
                return Ok((ws, true));
            }
        }
    }
    let ws = fallback_any_ws(port, &pages).await?;
    Ok((ws, true))
}

fn emit_issue(app: &AppHandle, issue: ChromeDevtoolsIssue) {
    let _ = app.emit(EVENT_ISSUE, issue);
}

fn extract_exception_text(params: &Value) -> String {
    let details = params.get("exceptionDetails");
    let text = details
        .and_then(|d| d.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("exception");
    let desc = details
        .and_then(|d| d.get("exception"))
        .and_then(|e| e.get("description"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            details
                .and_then(|d| d.get("exception"))
                .and_then(|e| e.get("value"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("");
    let url = details
        .and_then(|d| d.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let line = details
        .and_then(|d| d.get("lineNumber"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let mut out = if desc.is_empty() {
        text.to_string()
    } else {
        format!("{text}: {desc}")
    };
    let has_inline_stack = desc.contains('\n') || desc.contains(" at ");
    if !url.is_empty() {
        out.push_str(&format!(" at {url}:{line}"));
    }
    let stack = extract_compact_stack_suffix(params);
    if !stack.is_empty() && !has_inline_stack {
        out.push_str(&stack);
    }
    out.replace('\n', " ").trim().to_string()
}

fn extract_compact_stack_suffix(params: &Value) -> String {
    let frames = params
        .pointer("/exceptionDetails/stackTrace/callFrames")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut parts = Vec::new();
    for frame in frames.iter().take(4) {
        let fn_name = frame
            .get("functionName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("(anonymous)");
        let url = frame.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let line = frame
            .get("lineNumber")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if url.is_empty() && fn_name == "(anonymous)" {
            continue;
        }
        parts.push(format!("{fn_name}@{url}:{line}"));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" | {}", parts.join(" "))
    }
}

fn extract_console_text(params: &Value) -> String {
    let args = params
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let parts: Vec<String> = args
        .iter()
        .map(|arg| {
            arg.get("description")
                .and_then(|v| v.as_str())
                .or_else(|| arg.get("value").and_then(|v| v.as_str()))
                .map(|s| s.to_string())
                .or_else(|| {
                    arg.get("value")
                        .map(|v| v.to_string().trim_matches('"').to_string())
                })
                .unwrap_or_else(|| arg.to_string())
        })
        .collect();
    let joined = parts.join(" ").replace('\n', " ");
    joined.trim().to_string()
}

#[derive(Debug, Deserialize)]
struct BindingPayload {
    kind: Option<String>,
    metric: Option<String>,
    value: Option<f64>,
    url: Option<String>,
    message: Option<String>,
}

fn parse_binding_payload(raw: &str) -> Option<BindingPayload> {
    serde_json::from_str(raw).ok()
}

const TRAIL_MAX: usize = 10;

fn push_trail(trail: &mut VecDeque<(String, String)>, metric: String, message: String) {
    let metric = metric.trim().to_string();
    let message = message.replace('\n', " ").trim().to_string();
    if metric.is_empty() && message.is_empty() {
        return;
    }
    trail.push_back((metric, message));
    while trail.len() > TRAIL_MAX {
        trail.pop_front();
    }
}

fn format_trail_suffix(trail: &VecDeque<(String, String)>) -> String {
    if trail.is_empty() {
        return String::new();
    }
    let body = trail
        .iter()
        .map(|(metric, message)| {
            if message.is_empty() {
                metric.clone()
            } else if metric.is_empty() {
                message.clone()
            } else {
                format!("{metric} {message}")
            }
        })
        .collect::<Vec<_>>()
        .join(" > ");
    format!(" | trail: {body}")
}

fn with_trail(message: String, trail: &VecDeque<(String, String)>) -> String {
    let suffix = format_trail_suffix(trail);
    if suffix.is_empty() {
        message
    } else {
        format!("{message}{suffix}")
    }
}

const MAX_EVIDENCE_B64_CHARS: usize = 1_500_000;

/// Core Web Vitals "poor" 阈值；仅 LCP/CLS/INP 升级为可自动修复的告警。
fn vitals_poor_alert(metric: &str, value: f64) -> Option<String> {
    vitals_poor_alert_with(metric, value, &VitalsThresholds::default())
}

fn vitals_poor_alert_with(metric: &str, value: f64, t: &VitalsThresholds) -> Option<String> {
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    match metric {
        "lcp" if value >= t.lcp_ms as f64 => {
            Some(format!(
                "LCP {}ms exceeds {}ms",
                value.round() as u64,
                t.lcp_ms
            ))
        }
        "cls" if value >= t.cls => Some(format!("CLS {value} exceeds {}", t.cls)),
        "inp" if value >= t.inp_ms as f64 => {
            Some(format!(
                "INP {}ms exceeds {}ms",
                value.round() as u64,
                t.inp_ms
            ))
        }
        _ => None,
    }
}

fn sanitize_evidence_session_id(session_id: &str) -> String {
    let safe: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "default".into()
    } else {
        safe
    }
}

fn decode_jpeg_base64(jpeg_base64: &str) -> Result<Vec<u8>, String> {
    let trimmed = jpeg_base64.trim();
    if trimmed.is_empty() {
        return Err("empty screenshot".into());
    }
    if trimmed.len() > MAX_EVIDENCE_B64_CHARS {
        return Err("screenshot too large".into());
    }
    let payload = trimmed
        .strip_prefix("data:image/jpeg;base64,")
        .or_else(|| trimmed.strip_prefix("data:image/jpg;base64,"))
        .unwrap_or(trimmed);
    base64::engine::general_purpose::STANDARD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(payload.replace('\n', "")))
        .map_err(|e| format!("decode screenshot: {e}"))
}

pub(crate) fn write_jpeg_evidence(
    dir: &Path,
    session_id: &str,
    jpeg_base64: &str,
) -> Result<PathBuf, String> {
    let bytes = decode_jpeg_base64(jpeg_base64)?;
    fs::create_dir_all(dir).map_err(|e| format!("mkdir evidence: {e}"))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!(
        "{}-{ts}.jpg",
        sanitize_evidence_session_id(session_id)
    );
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| format!("write evidence: {e}"))?;
    Ok(path)
}

/// 将 CDP / 扩展截到的 JPEG 写入 `~/.wise/page-monitor-evidence/`。
pub fn save_page_monitor_jpeg_evidence(
    session_id: &str,
    jpeg_base64: &str,
) -> Result<String, String> {
    let dir = crate::wise_paths::wise_dir()?.join("page-monitor-evidence");
    write_jpeg_evidence(&dir, session_id, jpeg_base64).map(|p| p.to_string_lossy().into_owned())
}

struct PendingScreenshot {
    message: String,
    url: Option<String>,
    value: Option<f64>,
}

async fn run_cdp_loop(
    app: AppHandle,
    session_id: String,
    ws_url: String,
    navigate_url: Option<String>,
    monitor_url: String,
    vitals: VitalsThresholds,
    synthetic_interval_secs: u64,
    mut cancel_rx: watch::Receiver<bool>,
    mut cmd_rx: mpsc::UnboundedReceiver<MonitorCmd>,
) {
    let Ok((ws, _)) = connect_async(&ws_url).await else {
        emit_issue(
            &app,
            ChromeDevtoolsIssue {
                session_id,
                kind: "page-error".into(),
                message: "无法连接 Chrome DevTools WebSocket".into(),
                url: None,
                method: None,
                status: None,
                metric: None,
                value: None,
                duration_ms: None,
                resource_type: None,
                evidence_path: None,
            },
        );
        return;
    };
    let (mut write, mut read) = ws.split();
    let next_id = AtomicU64::new(1);
    let mut request_urls: HashMap<String, (String, String, f64)> = HashMap::new();
    let mut trail: VecDeque<(String, String)> = VecDeque::new();
    let mut pending_shots: HashMap<u64, PendingScreenshot> = HashMap::new();
    let mut alerted_vitals: HashSet<String> = HashSet::new();

    let send = |method: &str, params: Value| {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        json!({ "id": id, "method": method, "params": params })
    };

    let mut bootstrap = vec![
        send("Network.enable", json!({})),
        send("Runtime.enable", json!({})),
        send("Page.enable", json!({})),
        send("Log.enable", json!({})),
        send("Runtime.addBinding", json!({ "name": WISE_BINDING_NAME })),
        send(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": PAGE_INJECTION_SCRIPT }),
        ),
        send(
            "Runtime.evaluate",
            json!({ "expression": PAGE_INJECTION_SCRIPT }),
        ),
    ];
    if let Some(url) = navigate_url {
        bootstrap.push(send("Page.navigate", json!({ "url": url })));
    }
    for msg in bootstrap {
        if write.send(Message::Text(msg.to_string())).await.is_err() {
            return;
        }
    }

    let synthetic_on = synthetic_interval_secs > 0;
    let mut ticker = tokio::time::interval(Duration::from_secs(if synthetic_on {
        synthetic_interval_secs
    } else {
        3600
    }));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await;

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    break;
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(MonitorCmd::Reload) => {
                        let msg = send("Page.reload", json!({ "ignoreCache": true }));
                        if write.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = ticker.tick() => {
                if synthetic_on {
                    let result = probe_synthetic_url(&monitor_url).await;
                    if let Some(issue) = synthetic_check_issue(&session_id, &monitor_url, result) {
                        emit_issue(&app, issue);
                    }
                }
            }
            frame = read.next() => {
                let Some(frame) = frame else { break; };
                let Ok(Message::Text(text)) = frame else { continue; };
                let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };

                if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
                    if let Some(pending) = pending_shots.remove(&id) {
                        let evidence_path = value
                            .pointer("/result/data")
                            .and_then(|v| v.as_str())
                            .and_then(|data| save_page_monitor_jpeg_evidence(&session_id, data).ok());
                        let mut message = pending.message;
                        if let Some(path) = evidence_path.as_ref() {
                            message = format!("{message} evidence: {path}");
                        }
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "blank-screen".into(),
                            message,
                            url: pending.url,
                            method: None,
                            status: None,
                            metric: None,
                            value: pending.value,
                            duration_ms: None,
                            resource_type: None,
                            evidence_path,
                        });
                    }
                    continue;
                }
                let Some(method) = value.get("method").and_then(|v| v.as_str()) else { continue; };
                let params = value.get("params").cloned().unwrap_or(json!({}));

                match method {
                    "Runtime.exceptionThrown" => {
                        let mut message = extract_exception_text(&params);
                        if message.is_empty() { continue; }
                        let script_url = params
                            .pointer("/exceptionDetails/url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let line = params
                            .pointer("/exceptionDetails/lineNumber")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let column = params
                            .pointer("/exceptionDetails/columnNumber")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        message = append_orig_location(message, script_url, line, column).await;
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "page-error".into(),
                            message: with_trail(message, &trail),
                            url: if script_url.is_empty() {
                                None
                            } else {
                                Some(script_url.to_string())
                            },
                            method: None,
                            status: None,
                            metric: None,
                            value: None,
                            duration_ms: None,
                            resource_type: None,
                            evidence_path: None,
                        });
                    }
                    "Runtime.consoleAPICalled" => {
                        let level = params.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if level != "error" && level != "warning" && level != "assert" {
                            continue;
                        }
                        let message = extract_console_text(&params);
                        if message.is_empty() { continue; }
                        let kind = if level == "warning" { "console-warning" } else { "console-error" };
                        let message = if kind == "console-error" {
                            with_trail(message, &trail)
                        } else {
                            message
                        };
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: kind.into(),
                            message,
                            url: None,
                            method: None,
                            status: None,
                            metric: None,
                            value: None,
                            duration_ms: None,
                            resource_type: None,
                evidence_path: None,
                        });
                    }
                    "Runtime.bindingCalled" => {
                        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        if name != WISE_BINDING_NAME {
                            continue;
                        }
                        let raw = params.get("payload").and_then(|v| v.as_str()).unwrap_or("");
                        let Some(payload) = parse_binding_payload(raw) else { continue; };
                        match payload.kind.as_deref() {
                            Some("vitals") => {
                                let Some(metric) = payload.metric else { continue; };
                                let Some(value) = payload.value else { continue; };
                                if !matches!(metric.as_str(), "lcp" | "cls" | "inp" | "fcp" | "ttfb") {
                                    continue;
                                }
                                let message = if metric == "cls" {
                                    format!("CLS {value}")
                                } else {
                                    format!("{} {}ms", metric.to_uppercase(), value.round() as u64)
                                };
                                emit_issue(&app, ChromeDevtoolsIssue {
                                    session_id: session_id.clone(),
                                    kind: "page-vitals".into(),
                                    message,
                                    url: payload.url.clone(),
                                    method: None,
                                    status: None,
                                    metric: Some(metric.clone()),
                                    value: Some(value),
                                    duration_ms: None,
                                    resource_type: None,
                                    evidence_path: None,
                                });
                                if let Some(alert) = vitals_poor_alert_with(&metric, value, &vitals) {
                                    if alerted_vitals.insert(metric.clone()) {
                                        emit_issue(&app, ChromeDevtoolsIssue {
                                            session_id: session_id.clone(),
                                            kind: "vitals-alert".into(),
                                            message: with_trail(alert, &trail),
                                            url: payload.url,
                                            method: None,
                                            status: None,
                                            metric: Some(metric),
                                            value: Some(value),
                                            duration_ms: None,
                                            resource_type: None,
                                            evidence_path: None,
                                        });
                                    }
                                }
                            }
                            Some("long-task") => {
                                let Some(value) = payload.value else { continue; };
                                if (value.round() as u64) < LONG_TASK_REPORT_MS {
                                    continue;
                                }
                                let duration = value.round() as u64;
                                emit_issue(&app, ChromeDevtoolsIssue {
                                    session_id: session_id.clone(),
                                    kind: "long-task".into(),
                                    message: format!("{duration}ms main-thread block"),
                                    url: payload.url,
                                    method: None,
                                    status: None,
                                    metric: None,
                                    value: Some(value),
                                    duration_ms: Some(duration),
                                    resource_type: None,
                evidence_path: None,
                                });
                            }
                            Some("breadcrumb") => {
                                let metric = payload
                                    .metric
                                    .unwrap_or_else(|| "action".into())
                                    .trim()
                                    .to_ascii_lowercase();
                                if !matches!(
                                    metric.as_str(),
                                    "click" | "input" | "submit" | "navigate"
                                ) {
                                    continue;
                                }
                                let message = payload
                                    .message
                                    .unwrap_or_default()
                                    .replace('\n', " ")
                                    .trim()
                                    .to_string();
                                let message = if message.is_empty() {
                                    metric.clone()
                                } else {
                                    message
                                };
                                push_trail(&mut trail, metric.clone(), message.clone());
                                emit_issue(&app, ChromeDevtoolsIssue {
                                    session_id: session_id.clone(),
                                    kind: "breadcrumb".into(),
                                    message,
                                    url: payload.url,
                                    method: None,
                                    status: None,
                                    metric: Some(metric),
                                    value: None,
                                    duration_ms: None,
                                    resource_type: None,
                evidence_path: None,
                                });
                            }
                            Some("timing") => {
                                let Some(metric) = payload.metric else { continue; };
                                let metric = metric.trim().to_ascii_lowercase();
                                if !matches!(metric.as_str(), "dcl" | "load") {
                                    continue;
                                }
                                let Some(value) = payload.value else { continue; };
                                if !value.is_finite() || value < 0.0 {
                                    continue;
                                }
                                let duration = value.round() as u64;
                                emit_issue(&app, ChromeDevtoolsIssue {
                                    session_id: session_id.clone(),
                                    kind: "page-timing".into(),
                                    message: format!("{} {duration}ms", metric.to_uppercase()),
                                    url: payload.url,
                                    method: None,
                                    status: None,
                                    metric: Some(metric),
                                    value: Some(value),
                                    duration_ms: Some(duration),
                                    resource_type: None,
                evidence_path: None,
                                });
                            }
                            Some("blank-screen") => {
                                let message = payload
                                    .message
                                    .unwrap_or_else(|| "blank screen".into())
                                    .replace('\n', " ")
                                    .trim()
                                    .to_string();
                                if message.is_empty() {
                                    continue;
                                }
                                let pending = PendingScreenshot {
                                    message: with_trail(message, &trail),
                                    url: payload.url,
                                    value: payload.value,
                                };
                                let id = next_id.fetch_add(1, Ordering::Relaxed);
                                pending_shots.insert(id, pending);
                                let msg = json!({
                                    "id": id,
                                    "method": "Page.captureScreenshot",
                                    "params": { "format": "jpeg", "quality": 50 }
                                });
                                if write.send(Message::Text(msg.to_string())).await.is_err() {
                                    if let Some(pending) = pending_shots.remove(&id) {
                                        emit_issue(&app, ChromeDevtoolsIssue {
                                            session_id: session_id.clone(),
                                            kind: "blank-screen".into(),
                                            message: pending.message,
                                            url: pending.url,
                                            method: None,
                                            status: None,
                                            metric: None,
                                            value: pending.value,
                                            duration_ms: None,
                                            resource_type: None,
                                            evidence_path: None,
                                        });
                                    }
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    "Page.crashEvent" => {
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "page-crash".into(),
                            message: with_trail("main frame crashed".into(), &trail),
                            url: None,
                            method: None,
                            status: None,
                            metric: None,
                            value: None,
                            duration_ms: None,
                            resource_type: None,
                evidence_path: None,
                        });
                    }
                    "Network.requestWillBeSent" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let method_name = params.pointer("/request/method").and_then(|v| v.as_str()).unwrap_or("GET");
                        let url = params.pointer("/request/url").and_then(|v| v.as_str()).unwrap_or("");
                        let timestamp = params.get("timestamp").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        request_urls.insert(
                            request_id.to_string(),
                            (method_name.to_string(), url.to_string(), timestamp),
                        );
                    }
                    "Network.responseReceived" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let status = params.pointer("/response/status").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
                        let (method_name, url, request_ts) = request_urls
                            .get(request_id)
                            .cloned()
                            .unwrap_or_else(|| {
                                let u = params.pointer("/response/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                ("GET".into(), u, 0.0)
                            });
                        let resource_type = params
                            .get("type")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        if status < 400 {
                            let response_ts = params.get("timestamp").and_then(|v| v.as_f64()).unwrap_or(0.0);
                            if response_ts > 0.0 && request_ts > 0.0 && !url.is_empty() {
                                let duration = ((response_ts - request_ts) * 1000.0) as u64;
                                if duration >= SLOW_REQUEST_REPORT_MS {
                                    emit_issue(&app, ChromeDevtoolsIssue {
                                        session_id: session_id.clone(),
                                        kind: "slow-request".into(),
                                        message: format!("{method_name} {url} {status} in {duration}ms"),
                                        url: Some(url),
                                        method: Some(method_name),
                                        status: Some(status),
                                        metric: None,
                                        value: None,
                                        duration_ms: Some(duration),
                                        resource_type,
                                        evidence_path: None,
                                    });
                                }
                            }
                            continue;
                        }
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "network-http".into(),
                            message: format!("{method_name} {url} {status}"),
                            url: Some(url),
                            method: Some(method_name),
                            status: Some(status),
                            metric: None,
                            value: None,
                            duration_ms: None,
                            resource_type,
                            evidence_path: None,
                        });
                    }
                    "Network.loadingFailed" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let error_text = params.get("errorText").and_then(|v| v.as_str()).unwrap_or("failed");
                        let lower = error_text.to_ascii_lowercase();
                        if lower.contains("abort") || lower.contains("cancel") {
                            continue;
                        }
                        let (method_name, url, _) = request_urls
                            .remove(request_id)
                            .unwrap_or_else(|| ("GET".into(), String::new(), 0.0));
                        let resource_type = params
                            .get("type")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "network-failed".into(),
                            message: error_text.to_string(),
                            url: if url.is_empty() { None } else { Some(url) },
                            method: Some(method_name),
                            status: None,
                            metric: None,
                            value: None,
                            duration_ms: None,
                            resource_type,
                            evidence_path: None,
                        });
                    }
                    _ => {}
                }
            }
        }
    }
}

fn stop_session_locked(session: &mut MonitorSession) {
    let _ = session.cancel_tx.send(true);
    if let Some(task) = session.task.take() {
        task.abort();
    }
    // Only kill Chrome we launched ourselves. Attach mode keeps child = None.
    if let Some(mut child) = session.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn normalize_mode(mode: Option<String>) -> Result<&'static str, String> {
    match mode
        .as_deref()
        .unwrap_or("launch")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "" | "launch" | "standalone" | "new" => Ok("launch"),
        "attach" | "existing" | "reuse" => Ok("attach"),
        "extension" | "ext" | "plugin" => Ok("extension"),
        other => Err(format!(
            "未知监控模式「{other}」，请使用 launch / attach / extension"
        )),
    }
}

#[tauri::command]
pub async fn chrome_devtools_monitor_start(
    app: AppHandle,
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
    url: String,
    mode: Option<String>,
    debug_port: Option<u16>,
    vitals: Option<VitalsThresholds>,
    synthetic_interval_secs: Option<u64>,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let url = url.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("url 必须是 http(s)".into());
    }
    let mode = normalize_mode(mode)?;
    let vitals = normalize_vitals_thresholds(vitals);
    let synthetic_interval_secs = normalize_synthetic_interval_secs(synthetic_interval_secs);

    {
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        if let Some(mut existing) = guard.remove(&session_id) {
            stop_session_locked(&mut existing);
        }
    }

    let (child, ws_url, navigate_url) = if mode == "extension" {
        let port = crate::chrome_page_monitor_bridge::ensure_started(app.clone()).await?;
        crate::chrome_page_monitor_bridge::set_active_monitor(
            &session_id,
            &url,
            vitals,
            synthetic_interval_secs,
        )?;
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let session_clone = session_id.clone();
        let url_clone = url.clone();
        let app_clone = app.clone();
        let task = tokio::spawn(async move {
            run_synthetic_loop(
                app_clone,
                session_clone.clone(),
                url_clone,
                synthetic_interval_secs,
                cancel_rx,
            )
            .await;
            crate::chrome_page_monitor_bridge::clear_active_monitor(&session_clone);
        });
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        guard.insert(
            session_id.clone(),
            MonitorSession {
                child: None,
                cancel_tx,
                cmd_tx: None,
                extension_mode: true,
                task: Some(task),
            },
        );
        let _ = port;
        return Ok(());
    } else if mode == "attach" {
        let port = debug_port.unwrap_or(DEFAULT_ATTACH_DEBUG_PORT);
        if port == 0 {
            return Err("debugPort 无效".into());
        }
        probe_debug_port(port).await?;
        let (ws, should_navigate) = resolve_page_ws_url(port, &url).await?;
        (
            None,
            ws,
            if should_navigate {
                Some(url.clone())
            } else {
                None
            },
        )
    } else {
        let profile = wise_chrome_profile_dir(&session_id)?;
        let child = launch_chrome(&profile, &url)?;
        let (port, _path) = wait_for_devtools_port(&profile).await?;
        tokio::time::sleep(Duration::from_millis(400)).await;
        let (ws, _) = resolve_page_ws_url(port, &url).await?;
        (Some(child), ws, Some(url.clone()))
    };

    let (cancel_tx, cancel_rx) = watch::channel(false);
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let app_clone = app.clone();
    let session_clone = session_id.clone();
    let monitor_url = url.clone();
    let task = tokio::spawn(async move {
        run_cdp_loop(
            app_clone,
            session_clone,
            ws_url,
            navigate_url,
            monitor_url,
            vitals,
            synthetic_interval_secs,
            cancel_rx,
            cmd_rx,
        )
        .await;
    });

    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
    guard.insert(
        session_id,
        MonitorSession {
            child,
            cancel_tx,
            cmd_tx: Some(cmd_tx),
            extension_mode: false,
            task: Some(task),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn chrome_devtools_monitor_reload(
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    let (extension_mode, cmd_tx) = {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        let Some(session) = guard.get(&session_id) else {
            return Err("当前没有进行中的页面监控会话".into());
        };
        (session.extension_mode, session.cmd_tx.clone())
    };
    if extension_mode {
        crate::chrome_page_monitor_bridge::request_reload(&session_id)?;
        return Ok(());
    }
    let Some(tx) = cmd_tx else {
        return Err("当前监控会话不支持刷新".into());
    };
    tx.send(MonitorCmd::Reload)
        .map_err(|_| "页面刷新指令发送失败（监控连接可能已断开）".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn chrome_devtools_monitor_stop(
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
    if let Some(mut existing) = guard.remove(&session_id) {
        stop_session_locked(&mut existing);
    }
    crate::chrome_page_monitor_bridge::clear_active_monitor(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn chrome_page_monitor_bridge_status(
    app: AppHandle,
) -> Result<crate::chrome_page_monitor_bridge::ActiveMonitorSnapshot, String> {
    let _ = crate::chrome_page_monitor_bridge::ensure_started(app).await?;
    Ok(crate::chrome_page_monitor_bridge::active_monitor_snapshot())
}

#[tauri::command]
pub fn chrome_page_monitor_extension_dir(app: AppHandle) -> Result<String, String> {
    crate::chrome_page_monitor_bridge::resolve_extension_dir(&app)
        .map(|p| p.display().to_string())
}

/// Export the app-bundled Chrome extension into `~/Downloads/wise-page-monitor`
/// and reveal that folder. Never opens the repo source tree.
#[tauri::command]
pub fn chrome_page_monitor_download_extension(app: AppHandle) -> Result<String, String> {
    let dest = crate::chrome_page_monitor_bridge::download_extension(&app)?;
    let path = dest.to_string_lossy().to_string();
    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| format!("扩展已下载到 {path}，但打开目录失败：{e}"))?;
    Ok(path)
}

/// Compatibility wrapper: same as [`chrome_page_monitor_download_extension`].
#[tauri::command]
pub fn chrome_page_monitor_open_extension_dir(app: AppHandle) -> Result<(), String> {
    chrome_page_monitor_download_extension(app).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_map_urls, extract_compact_stack_suffix, format_trail_suffix,
        lookup_orig_in_map_bytes, normalize_synthetic_interval_secs, normalize_url_for_match,
        normalize_vitals_thresholds, parse_binding_payload, push_trail, score_page_url_match,
        synthetic_check_issue, urlencoding_minimal, vitals_poor_alert, vitals_poor_alert_with,
        write_jpeg_evidence, VitalsThresholds,
    };
    use serde_json::json;
    use std::collections::VecDeque;
    use std::fs;

    #[test]
    fn url_match_prefers_exact() {
        assert_eq!(
            score_page_url_match("http://localhost:3000/app", "http://localhost:3000/app"),
            100
        );
        assert!(
            score_page_url_match("http://localhost:3000/app", "http://localhost:3000/app/") >= 60
        );
        assert_eq!(
            score_page_url_match("http://localhost:3000/other", "http://localhost:3000/app"),
            30
        );
        assert_eq!(
            score_page_url_match("http://127.0.0.1:3000/", "http://localhost:3000/"),
            0
        );
    }

    #[test]
    fn normalize_strips_hash_and_slash() {
        assert_eq!(
            normalize_url_for_match("http://localhost:3000/app/#/x"),
            "http://localhost:3000/app"
        );
    }

    #[test]
    fn urlencoding_keeps_url_safe_chars() {
        let enc = urlencoding_minimal("http://localhost:3000/a b");
        assert!(enc.contains("http://localhost:3000/a"));
        assert!(enc.contains("%20"));
    }

    #[test]
    fn binding_payload_parses_vitals_and_long_task() {
        let vitals = parse_binding_payload(r#"{"kind":"vitals","metric":"lcp","value":2500}"#)
            .expect("vitals payload");
        assert_eq!(vitals.kind.as_deref(), Some("vitals"));
        assert_eq!(vitals.metric.as_deref(), Some("lcp"));
        assert_eq!(vitals.value, Some(2500.0));
        assert!(vitals.url.is_none());

        let long_task =
            parse_binding_payload(r#"{"kind":"long-task","value":812,"url":"http://x/a.js"}"#)
                .expect("long-task payload");
        assert_eq!(long_task.kind.as_deref(), Some("long-task"));
        assert_eq!(long_task.value, Some(812.0));
        assert_eq!(long_task.url.as_deref(), Some("http://x/a.js"));

        assert!(parse_binding_payload("not json").is_none());

        let crumb = parse_binding_payload(
            r#"{"kind":"breadcrumb","metric":"click","message":"button#save","url":"http://x/"}"#,
        )
        .expect("breadcrumb payload");
        assert_eq!(crumb.kind.as_deref(), Some("breadcrumb"));
        assert_eq!(crumb.metric.as_deref(), Some("click"));
        assert_eq!(crumb.message.as_deref(), Some("button#save"));

        let timing = parse_binding_payload(r#"{"kind":"timing","metric":"dcl","value":320}"#)
            .expect("timing payload");
        assert_eq!(timing.kind.as_deref(), Some("timing"));
        assert_eq!(timing.metric.as_deref(), Some("dcl"));
        assert_eq!(timing.value, Some(320.0));
    }

    #[test]
    fn trail_suffix_joins_recent_actions() {
        let mut trail = VecDeque::new();
        push_trail(&mut trail, "click".into(), "button#save".into());
        push_trail(&mut trail, "navigate".into(), "pushState http://x/app".into());
        assert_eq!(
            format_trail_suffix(&trail),
            " | trail: click button#save > navigate pushState http://x/app"
        );
    }

    #[test]
    fn compact_stack_takes_top_frames() {
        let params = json!({
            "exceptionDetails": {
                "stackTrace": {
                    "callFrames": [
                        { "functionName": "boom", "url": "http://x/app.js", "lineNumber": 12 },
                        { "functionName": "", "url": "http://x/app.js", "lineNumber": 40 }
                    ]
                }
            }
        });
        assert_eq!(
            extract_compact_stack_suffix(&params),
            " | boom@http://x/app.js:12 (anonymous)@http://x/app.js:40"
        );
    }

    #[test]
    fn vitals_poor_alert_uses_core_web_vitals_poor_thresholds() {
        assert!(vitals_poor_alert("lcp", 3999.0).is_none());
        assert_eq!(
            vitals_poor_alert("lcp", 4000.0).as_deref(),
            Some("LCP 4000ms exceeds 4000ms")
        );
        assert!(vitals_poor_alert("cls", 0.249).is_none());
        assert_eq!(
            vitals_poor_alert("cls", 0.25).as_deref(),
            Some("CLS 0.25 exceeds 0.25")
        );
        assert!(vitals_poor_alert("inp", 499.0).is_none());
        assert_eq!(
            vitals_poor_alert("inp", 512.0).as_deref(),
            Some("INP 512ms exceeds 500ms")
        );
        assert!(vitals_poor_alert("fcp", 9000.0).is_none());
        assert!(vitals_poor_alert("ttfb", 9000.0).is_none());
    }

    #[test]
    fn vitals_thresholds_clamp_and_custom_alert() {
        let raw = VitalsThresholds {
            lcp_ms: 1,
            cls: 9.0,
            inp_ms: 12,
        };
        let t = normalize_vitals_thresholds(Some(raw));
        assert_eq!(t.lcp_ms, 500);
        assert_eq!(t.cls, 2.0);
        assert_eq!(t.inp_ms, 50);
        assert_eq!(normalize_synthetic_interval_secs(None), 30);
        assert_eq!(normalize_synthetic_interval_secs(Some(0)), 0);
        assert_eq!(normalize_synthetic_interval_secs(Some(5)), 10);
        assert_eq!(normalize_synthetic_interval_secs(Some(900)), 600);

        let custom = VitalsThresholds {
            lcp_ms: 2000,
            cls: 0.1,
            inp_ms: 200,
        };
        assert!(vitals_poor_alert_with("lcp", 1999.0, &custom).is_none());
        assert_eq!(
            vitals_poor_alert_with("lcp", 2000.0, &custom).as_deref(),
            Some("LCP 2000ms exceeds 2000ms")
        );
        assert!(vitals_poor_alert_with("cls", 0.09, &custom).is_none());
        assert_eq!(
            vitals_poor_alert_with("cls", 0.1, &custom).as_deref(),
            Some("CLS 0.1 exceeds 0.1")
        );
    }

    #[test]
    fn sourcemap_lookup_uses_identity_mapping() {
        let map = br#"{
          "version": 3,
          "file": "app.js",
          "sources": ["src/App.tsx"],
          "names": [],
          "mappings": "AAAA"
        }"#;
        assert_eq!(
            lookup_orig_in_map_bytes(map, 0, 0).as_deref(),
            Some("src/App.tsx:1:1")
        );
        assert_eq!(
            candidate_map_urls("https://x.test/app.js?v=1#hash"),
            vec![
                "https://x.test/app.js.map".to_string(),
                "https://x.test/app.js.map?v=1".to_string()
            ]
        );
        assert!(candidate_map_urls("chrome-extension://x/app.js").is_empty());
        assert!(candidate_map_urls("https://x.test/app.js.map").is_empty());
    }

    #[test]
    fn synthetic_check_emits_http_and_network_failures() {
        let http = synthetic_check_issue("s1", "http://localhost:5173", Ok(502)).unwrap();
        assert_eq!(http.kind, "synthetic-check");
        assert_eq!(http.message, "GET http://localhost:5173 502");
        assert_eq!(http.status, Some(502));
        assert!(synthetic_check_issue("s1", "http://localhost:5173", Ok(200)).is_none());
        let fail = synthetic_check_issue(
            "s1",
            "http://localhost:5173",
            Err("connection refused".into()),
        )
        .unwrap();
        assert!(fail.message.contains("failed"));
        assert!(fail.message.contains("error"));
    }

    #[test]
    fn write_jpeg_evidence_decodes_and_sanitizes_session() {
        let root = std::env::temp_dir().join(format!(
            "wise-page-monitor-evidence-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            b"\xff\xd8\xfffakejpeg",
        );
        let path = write_jpeg_evidence(&root, "sess 1", &b64).unwrap();
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("jpg"));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("sess_1-"));
        assert_eq!(fs::read(&path).unwrap(), b"\xff\xd8\xfffakejpeg");
        assert!(write_jpeg_evidence(&root, "x", "not-base64").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
