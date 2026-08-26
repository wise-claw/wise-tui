# 页面监控能力调研与扩充

## 1. 调研范围

对比主流前端监控 / RUM 产品与 Wise「页面监控」现状：

- 错误与性能监控：Sentry Browser SDK、Datadog RUM、New Relic Browser、Google web-vitals
- 会话回放：LogRocket
- 国内私有化前端监控：Webfunny、阿里 ARMS、Fundebug

## 2. 主流能力矩阵

| 能力 | Sentry | Datadog RUM | New Relic | LogRocket | Webfunny / ARMS | Wise（当前） |
| --- | --- | --- | --- | --- | --- | --- |
| JS 异常 + 堆栈 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（堆栈摘要） |
| console error/warning | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 接口 4xx/5xx | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 网络失败（net::ERR） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 资源加载失败（img/script/css） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（标注资源类型） |
| 慢请求 / 接口耗时 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web Vitals（LCP/CLS/INP/FCP/TTFB） | ✅ | ✅ | ✅ | 部分 | ✅ | ✅ |
| 长任务 / 主线程卡顿 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 页面崩溃检测 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 页面加载时序（load/DCL） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 用户行为 / 会话回放 | breadcrumbs | 会话 | 会话 | ✅ | 用户细查 | ✅ 操作轨迹（非会话录像） |
| 白屏检测 | 部分 | ✅ | 部分 | 部分 | ✅ | ✅（含证据截图） |
| SourceMap 源码定位 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（lite：`.map` 栈顶） |
| 告警 / 自动化修复 | 告警 | 告警 | 告警 | 告警 | 告警 | ✅ AI 自动修复 + 可配置 Vitals + 探活 |

## 3. v0.2.0 扩充

在保留原有 `page-error / console-error / console-warning / network-http / network-failed` 五类问题前提下新增：

- **Web Vitals**：`page-vitals`（lcp/cls/inp/fcp/ttfb），注入 PerformanceObserver 采集
- **长任务**：`long-task`（≥500ms 主线程阻塞）
- **慢请求**：`slow-request`（请求耗时 ≥3s，含 2xx）
- **页面崩溃**：`page-crash`（`Page.crashEvent`）
- **资源类型标注**：`network-http / network-failed` 附带 `resourceType`（Image/Script/Stylesheet/Font 等），静态资源失败更醒目

## 4. v0.3.0 扩充（插件可扩展能力落地）

Chrome 扩展与 `launch` / `attach` CDP 共用同一套注入脚本，新增：

- **用户操作轨迹**：`breadcrumb`（click / input / submit / pushState·replaceState·hashchange·popstate）。预览最多保留 2 条以免淹没错误；最近 10 步会附在 `page-error` / `console-error` / `blank-screen` / `page-crash` 的 `trail:` 上，供 AI 自动修复定位操作路径。密码框只记录控件，不记录值。
- **页面加载时序**：`page-timing`（DCL / Load，来自 Navigation Timing）
- **白屏检测**：`blank-screen`。load 后 2.5s 与 6s 连续观察：可见节点 < 8、文本 < 40 字、且无足够大的 canvas/video/svg/img/iframe 才上报；可触发 AI 自动修复。
- **堆栈摘要**：`Runtime.exceptionThrown` 取前 4 帧 `fn@url:line`，在 description 未自带 stack 时补上。

产品规则：性能 / 轨迹类诊断（vitals / long-task / slow-request / breadcrumb / page-timing）仅进入监控面板展示，不触发 AI 自动修复；错误类（page-crash / blank-screen / vitals-alert 等）照常进入自动修复指纹与派发。

实现覆盖三条链路，采集逻辑保持一致：

1. `launch` / `attach`：`src-tauri/src/chrome_devtools_monitor.rs` CDP 直连循环
2. `extension`：`browser-extensions/wise-page-monitor/background.js`（chrome.debugger）
3. 注入脚本：`PAGE_INJECTION_SCRIPT`（Rust 内嵌）与 `inject-vitals.js`（扩展侧）同步维护

## 5. v0.4.0 扩充

- **白屏证据图**：命中 `blank-screen` 后走 `Page.captureScreenshot`（jpeg q50），写入 `~/.wise/page-monitor-evidence/`。扩展经 `POST /v1/evidence` 落盘；CDP 直连在截图回包后发出带 `evidencePath` 的 issue。面板用 `asset://` 显示缩略图；自动修复提示带本机路径。
- **操作时间线 UI**：`breadcrumb` 不再挤占问题预览，按会话保留最近 8 步（点击 / 输入 / 提交 / 路由）显示在「最近操作」。
- **Vitals 劣化告警**：LCP≥4000ms / CLS≥0.25 / INP≥500ms 升为 `vitals-alert`（每指标每标签一次），可触发 AI 自动修复。FCP/TTFB 仍只做诊断展示。

## 6. v0.5.0 扩充

- **可配置 Vitals 阈值**：面板可改 LCP / CLS / INP，按仓库写入 localStorage；**开始监控时**下发给 CDP 循环与扩展桥 `/v1/active-monitor`（监控中不可改，不停监控热更新）。
- **会话探活**：开关「定时探活」（默认 30s，关=0）。三种模式都由 Rust 对监控 URL 做 GET；≥400 或网络失败发出 `synthetic-check`（可自动修复）。扩展不扩大 `host_permissions`。
- **SourceMap lite**：异常栈顶按 `{script}.map` 拉取映射（800ms 超时、缓存），还原 `| orig src/App.tsx:12:4`。扩展经 `POST /v1/source-location` 由 Rust 代拉，避免任意源 `host_permissions`。不启用 Debugger 域。

## 7. 后续方向（backlog）

- **阈值进仓库设置**：从 localStorage 迁到 `~/.wise` / 项目设置
- **完整 Automation 巡检调度**：独立于当前监控会话的多 URL 健康检查
- **会话录像**：在操作时间线之上增加轻量 DOM 快照 / rrweb
- **阈值热更新**：不重启监控即可改 LCP/CLS/INP
- **扩展侧直接拉 map**：需更广 `host_permissions`
