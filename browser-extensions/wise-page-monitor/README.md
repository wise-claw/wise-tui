# Wise 页面监控 · Chrome 扩展

把日常 Chrome 标签的页面异常、console、网络错误、Web Vitals、加载时序、长任务、慢请求、用户操作轨迹、白屏与页面崩溃转发到 Wise「页面监控 / AI 自动修复」。也可把网页里选中的文字和图片作为需求发送给 Wise 处理。

## 安装（开发者模式）

1. 打开 Chrome → `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录
4. 在 Wise 页面监控选择 **Chrome 扩展** → 开始监控

扩展会轮询 `http://127.0.0.1:17321/v1/active-monitor`，并对匹配标签使用 `chrome.debugger` 捕获问题。发送需求不依赖监控会话，但 Wise 桌面端需要正在运行。

## 发送选中图文为需求

在任意网页：

- 选中文字 / 图片 / 链接后右键 **发送到 Wise 作为需求**
- 空白处右键 **发送可见区域到 Wise**（整屏截图）
- 或按 `Alt+Shift+W`
- 或打开扩展弹窗点 **发送选中图文到 Wise** / **发送可见区域到 Wise**

发送前会弹出确认框，可补充需求说明（`⌘/Ctrl+Enter` 确认，`Esc` 取消）。Wise 会附上选区截图，并把标题、列表、链接转成 Markdown 写入需求列表，再派发到当前仓库的执行环境。跨域图片若无法内联，会保留原 URL 由 Wise 代拉。

采集范围：选区文字结构、`<img>` / 背景图 / canvas / 视频封面、Shadow DOM 内图片，以及当前可见区域截图。

## 采集能力

- 页面异常：`Runtime.exceptionThrown` → `page-error`（含堆栈摘要；错误会附带最近操作轨迹）
- console 报错 / 告警：`Runtime.consoleAPICalled` → `console-error` / `console-warning`
- 接口 4xx/5xx：`Network.responseReceived` → `network-http`（附资源类型）
- 网络失败：`Network.loadingFailed` → `network-failed`（附资源类型）
- 慢请求（≥ 3s）：请求耗时统计 → `slow-request`
- Web Vitals：注入脚本采集 LCP / CLS / INP / FCP / TTFB → `page-vitals`
- 页面加载时序：Navigation Timing 的 DCL / Load → `page-timing`
- 长任务（≥ 500ms）：`longtask` observer → `long-task`
- 用户操作轨迹：click / input / submit / history 路由 → `breadcrumb`（面板「最近操作」时间线；错误/白屏仍附带 trail）
- 白屏：load 后连续检测文本与可见节点阈值 → `blank-screen`（可触发 AI 自动修复；附 JPEG 证据图）
- 页面崩溃：`Page.crashEvent` → `page-crash`
- Core Web Vitals 劣化：启动时配置的 LCP/CLS/INP 阈值（缺省 4000ms / 0.25 / 500ms）→ `vitals-alert`（可触发 AI 自动修复）
- SourceMap 源码定位：异常栈顶通过 Wise 桥 `POST /v1/source-location` 还原为 `| orig src/App.tsx:12:4`

定时探活由 Wise 桌面端在监控会话内每 30 秒 GET 监控地址（扩展不直接外网探活），失败记为 `synthetic-check`。

注入脚本见 `inject-vitals.js`，与 Wise 内建 CDP 监控（`launch` / `attach` 模式）保持同一份采集逻辑。

## 说明

- 页顶可能出现「扩展正在调试此浏览器」提示，属 Chrome 正常行为
- 停止 Wise 监控后扩展会自动卸除调试附着
- 仅连接本机 `127.0.0.1`
