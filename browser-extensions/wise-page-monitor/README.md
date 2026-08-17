# Wise 页面监控 · Chrome 扩展

把日常 Chrome 标签的页面异常、console、网络错误、Web Vitals、长任务、慢请求与页面崩溃转发到 Wise「页面监控 / AI 自动修复」。

## 安装（开发者模式）

1. 打开 Chrome → `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录
4. 在 Wise 页面监控选择 **Chrome 扩展** → 开始监控

扩展会轮询 `http://127.0.0.1:17321/v1/active-monitor`，并对匹配标签使用 `chrome.debugger` 捕获问题。

## 采集能力

- 页面异常：`Runtime.exceptionThrown` → `page-error`
- console 报错 / 告警：`Runtime.consoleAPICalled` → `console-error` / `console-warning`
- 接口 4xx/5xx：`Network.responseReceived` → `network-http`（附资源类型）
- 网络失败：`Network.loadingFailed` → `network-failed`（附资源类型）
- 慢请求（≥ 3s）：请求耗时统计 → `slow-request`
- Web Vitals：注入脚本采集 LCP / CLS / INP / FCP / TTFB → `page-vitals`
- 长任务（≥ 500ms）：`longtask` observer → `long-task`
- 页面崩溃：`Page.crashEvent` → `page-crash`

注入脚本见 `inject-vitals.js`，与 Wise 内建 CDP 监控（`launch` / `attach` 模式）保持同一份采集逻辑。

## 说明

- 页顶可能出现「扩展正在调试此浏览器」提示，属 Chrome 正常行为
- 停止 Wise 监控后扩展会自动卸除调试附着
- 仅连接本机 `127.0.0.1`
