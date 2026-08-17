# 页面监控能力调研与扩充

## 1. 调研范围

对比主流前端监控 / RUM 产品与 Wise「页面监控」现状：

- 错误与性能监控：Sentry Browser SDK、Datadog RUM、New Relic Browser、Google web-vitals
- 会话回放：LogRocket
- 国内私有化前端监控：Webfunny、阿里 ARMS、Fundebug

## 2. 主流能力矩阵

| 能力 | Sentry | Datadog RUM | New Relic | LogRocket | Webfunny / ARMS | Wise（扩充前） |
| --- | --- | --- | --- | --- | --- | --- |
| JS 异常 + 堆栈 | ✅ | ✅ | ✅ | ✅ | ✅ | 部分（无堆栈） |
| console error/warning | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 接口 4xx/5xx | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 网络失败（net::ERR） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 资源加载失败（img/script/css） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（未标注资源类型） |
| 慢请求 / 接口耗时 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Web Vitals（LCP/CLS/INP/FCP/TTFB） | ✅ | ✅ | ✅ | 部分 | ✅ | ❌ |
| 长任务 / 主线程卡顿 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 页面崩溃检测 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 页面加载时序（load/DCL） | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 用户行为 / 会话回放 | breadcrumbs | 会话 | 会话 | ✅ | 用户细查 | ❌ |
| SourceMap 源码定位 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 告警 / 自动化修复 | 告警 | 告警 | 告警 | 告警 | 告警 | ✅ AI 自动修复（差异化） |

## 3. 本次扩充（v0.2.0）

在保留原有 `page-error / console-error / console-warning / network-http / network-failed` 五类问题前提下新增：

- **Web Vitals**：`page-vitals`（lcp/cls/inp/fcp/ttfb），注入 PerformanceObserver 采集
- **长任务**：`long-task`（≥500ms 主线程阻塞）
- **慢请求**：`slow-request`（请求耗时 ≥3s，含 2xx）
- **页面崩溃**：`page-crash`（`Page.crashEvent`）
- **资源类型标注**：`network-http / network-failed` 附带 `resourceType`（Image/Script/Stylesheet/Font 等），静态资源失败更醒目

实现覆盖三条链路，采集逻辑保持一致：

1. `launch` / `attach`：`src-tauri/src/chrome_devtools_monitor.rs` CDP 直连循环
2. `extension`：`browser-extensions/wise-page-monitor/background.js`（chrome.debugger）
3. 注入脚本：`PAGE_INJECTION_SCRIPT`（Rust 内嵌）与 `inject-vitals.js`（扩展侧）同步维护

产品规则：性能类诊断（vitals/long-task/slow-request）仅进入监控面板展示，不触发 AI 自动修复，避免开发期噪音；错误类（page-crash 等）照常进入自动修复指纹与派发。

## 4. 后续方向（backlog）

- **用户行为 breadcrumbs / 会话时间线**：注入脚本记录 click/input/路由切换，Wise 侧按会话聚合
- **白屏检测**：load 后 DOM/文本阈值 + `Page.captureScreenshot` 证据图
- **SourceMap 定位**：接收源码映射，错误行号还原为源码位置
- **定时巡检（synthetic check）**：按 Automation 面调度对 URL 做健康检查
- **告警阈值规则**：Web Vitals 劣化阈值可配置，超出转 AI 修复或通知
