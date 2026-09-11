<p align="center">
  <img src="imgs/icon.png" alt="Wise" width="96" height="96" />
</p>

<h1 align="center">Wise</h1>

<p align="center">
  <strong>面向 AI Agent 的桌面研发工作台</strong>
</p>

<p align="center">
  把工作区、Agent、执行环境、工作流、自动化、远程入口与产物检查放进同一套研发控制台
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

---

Wise 是一款基于 **Tauri 2** 的桌面 AI 研发工作台。它以本地 Git 仓库为工作上下文，把 AI 会话、终端、编辑器、Git、工作流和自动化连接起来；同时提供可管理的 Agent / Skill / MCP / 扩展生态，以及钉钉、飞书、企业微信、Telegram 和 WebSocket 等远程入口。

Wise 的目标不是再做一个聊天窗口，而是让 AI 研发从“对话”进入可运行、可观察、可复盘的工作流：

```text
工作区与需求 → Agent / 助手 → 执行环境 → 会话 / 工作流 → 代码与产物 → 审查、自动化与远程回执
```

<p align="center">
  <img src="imgs/home-full.png" alt="Wise AI 研发工作台" width="920" />
</p>

## 项目特色

| 特色 | Wise 提供的能力 |
| --- | --- |
| **从聊天到工作流** | 会话不再是孤立的消息记录；任务、阶段、运行状态、验收结果和执行历史都可以被组织、观察和恢复。 |
| **多引擎统一工作台** | 在同一套工作区和会话界面中接入 Claude Code、Codex RPC、Cursor Agent、Gemini CLI、OpenCode 和 Qoder CLI；具体可用性取决于本机 CLI 与账号配置。 |
| **Agent 供给可管理** | 通过助手模板、Agent 注册表、Skills、MCP、Hooks、插件与扩展，把角色、工具、权限和提示词变成可复用的研发资产。 |
| **Hub / Channel / Automation / Artifact** | 用 Hub 管理能力，用 Channel 接收远程请求与回执，用 Automation 执行定时任务，用 Artifact 检查代码、文档和运行产物。 |
| **本地优先且可溯源** | 仓库、会话、运行记录、配置和产物索引保存在本机；关键执行链路可追踪，适合个人开发与本地团队工作台。 |
| **浏览器问题进入 AI 修复链路** | 页面监控可采集异常、网络错误、Web Vitals、长任务、慢请求、白屏和崩溃，并将问题、操作轨迹与证据图派发给 Agent。 |
| **HUD 浮窗入口** | 用一个置顶胶囊快速切换仓库、会话、执行环境和模型，在不展开主窗口的情况下提交任务、查看状态和触发快捷操作。 |

## 核心工作台

### 1. 工作区：让仓库成为 AI 的上下文边界

- 单仓库快速开始，也支持将多个仓库组织为高级工作区。
- 每个仓库拥有独立的会话、执行环境、快捷操作、需求、定时任务与运行状态。
- 工作区内直接查看文件树、编辑代码、运行终端、管理分支、Diff、历史和 Worktree。
- 支持工作区备忘录、全局待办与需求派发，减少上下文在聊天工具和终端之间丢失。

### 2. 会话与执行环境：选择合适的 Agent 完成工作

- 支持创建、恢复、停止和并行运行多个 AI 会话。
- 支持多窗格布局，将会话、终端、文件和消息列表放在同一屏协作。
- 可按会话、仓库或助手选择执行引擎，并查看本机 Agent 的可用状态。
- Composer 支持富文本、文件 / 图片上下文、常用语、语音输入和快捷指令。
- 支持自动批准、沙箱、权限提示、模型配置、用量查看和会话进程管理。

当前可接入的执行环境包括：

| 执行环境 | 适用方向 |
| --- | --- |
| Claude Code | 默认研发会话、MCP、Skills、Hooks 与插件生态 |
| Codex RPC | Codex App-Server JSON-RPC 会话 |
| Cursor Agent | Cursor Agent ACP 会话与模型选择 |
| Gemini CLI | Gemini CLI 研发会话 |
| OpenCode | OpenCode 会话、模型切换与配置桥接 |
| Qoder CLI | Qoder CLI 流式研发会话 |

### 3. HUD 模式：随时可用的浮动 AI 入口

HUD 是 Wise 的轻量常驻浮窗，适合在编辑器、浏览器或终端之间工作时快速调用 AI。它会以置顶胶囊输入条的形式停留在桌面上，主窗口可以让到后台，任务仍然继续运行。

<p align="center">
  <img src="imgs/HUD模式.png" alt="Wise HUD 模式" width="920" />
</p>

- **全局切换**：按 `⌥H / Alt+H` 进入或退出 HUD；应用未聚焦时也可以打开。按 `⌘⇧G / Ctrl+Shift+G` 可将 HUD 吸附到当前指针位置。
- **上下文切换**：在浮窗内搜索并切换仓库、会话、执行环境和模型，也可以直接添加本地仓库。
- **多会话管理**：查看多个会话标签、运行状态和完成通知，展开详情后可快速回看当前会话内容。
- **一键执行**：新建会话、提交 / 停止任务、激活助手模板、运行仓库命令和工作区快捷操作都可以从 HUD 触发。
- **研发上下文保持**：支持富文本输入、`@` 文件上下文、图片、快捷指令和桌面截图；`⌥Z / Alt+Z` 可直接聚焦当前模式的输入框。
- **状态可见**：实时显示运行中的任务、Git 增删统计和完成结果；浮窗位置、尺寸与详情高度会被记住。

### 4. 工作流：把复杂任务变成可观察的阶段

- 通过工作流画布组织阶段、节点、派发关系和运行顺序。
- 支持模板、阶段状态、并行任务、执行快照、验收结果和失败重试。
- 运行记录与事件可回看，便于定位是输入、Agent、工具还是代码阶段出了问题。
- 可将工作流与助手、仓库、定时任务和远程入口组合，形成稳定的研发操作路径。

### 5. 能力 Hub：把 AI 工具链变成可组合资产

- **助手模板**：保存角色、模型、系统提示词、运行脚本与项目绑定。
- **Agents 探索**：扫描仓库 `.agents` 下的命令、技能与智能体。
- **MCP 工具**：管理用户级、仓库级、团队共享与扩展提供的 MCP Server。
- **技能市场**：发现并安装 `skills.sh` 等外部技能，也支持扩展贡献的技能。
- **Hooks / 插件 / 扩展**：统一管理 Claude Code 工具链事件、精选插件与 Wise 扩展。
- **扩展机制**：扩展可以贡献技能、主题、MCP、助手、设置页和生命周期脚本，并支持权限声明。

### 6. Automation 与 Channel：让研发动作走出主窗口

- **定时自动化**：按仓库管理 Cron 任务、Mission、会话续跑与后台执行记录。
- **代码审查**：支持未提交改动或相对主干的审查，可配置推送前门闸、高危问题确认 / 阻断、结果复用与报告导出。
- **远程入口**：统一配置钉钉、飞书、企业微信、Telegram 和通用 WebSocket，用于通知、回执与远程控制。
- **HUD / Mascot 浮窗**：在主窗口之外快速查看会话、切换标签和触发常用操作。

### 7. Artifact 与浏览器监控：让结果可检查、问题可定位

产物检查台支持按仓库浏览和预览 Markdown、Diff、图片、PDF、Office、HTML 与代码文本。

Chrome 页面监控支持通过 CDP 或 `wise-page-monitor` 扩展采集：

- JavaScript 异常、Console 错误 / 告警、接口错误和网络失败；
- LCP、CLS、INP、FCP、TTFB、页面加载时序、长任务和慢请求；
- 白屏、页面崩溃、操作轨迹、SourceMap 定位和截图证据；
- 将网页选中的文字、图片、链接或可见区域发送为当前仓库需求；
- 将可自动修复的问题派发给 Agent，并在工作台中跟踪修复会话。

更多说明见 [页面监控扩展 README](browser-extensions/wise-page-monitor/README.md)。

## 典型使用路径

1. **添加仓库**：从欢迎页选择单仓库，或创建多仓工作区。
2. **选择能力**：配置执行环境、助手、模型、MCP、Skills 或扩展。
3. **开始执行**：创建 AI 会话，或从工作流 / 需求 / 快捷操作派发任务。
4. **边做边看**：在会话、终端、编辑器、Git 和运行面板之间切换，观察并行执行状态。
5. **检查与沉淀**：审查 Diff，查看 Markdown / Office / HTML 等产物，保存运行记录。
6. **自动化与远程化**：把稳定动作放入定时任务，通过 Channel 接收通知、回执或远程指令。

## 快速开始

### 环境要求

- [Bun](https://bun.sh)，版本以 `package.json` 的 `packageManager` 为准（当前为 `bun@1.3.5`）；
- Rust stable；
- 对应平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)；
- 如需使用某个执行环境，请先在本机安装并登录对应 CLI，例如 Claude Code、Cursor Agent、OpenCode 或 Qoder。

### 安装与运行

```bash
# 安装依赖
bun install

# 启动桌面开发模式
bun run tauri:dev

# 运行前端测试
bun test

# 构建前端与桌面安装包
bun run build
bun run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 第一次使用

1. 在欢迎页点击「添加仓库」，选择一个本地 Git 仓库。
2. 在仓库的执行环境设置中确认可用的 CLI 和默认引擎。
3. 新建会话，或从左侧打开「助手模板」「MCP 工具」「技能市场」配置能力。
4. 需要多仓协作时，再创建工作区并关联其它仓库。

## 数据与安全

- Wise 的应用数据默认保存在 `~/.wise/`，包括 SQLite 数据库、仓库注册信息、窗口 / 会话状态、图片与监控证据。
- 仓库级扩展可放在 `<仓库>/.wise/extensions/`；全局扩展位于 `~/.wise/extensions/`。
- Agent 的实际文件读写、命令执行和网络能力由对应 CLI、Claude 沙箱、Wise 权限设置及扩展权限共同决定。
- API Key 与本地配置请按各执行环境的安全要求管理；不要把密钥提交到仓库或扩展包。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面应用 | Tauri 2、Rust |
| 前端 | React 19、TypeScript、Vite、Ant Design |
| 编辑与渲染 | Monaco、Tiptap、xterm.js、Mermaid |
| 图与工作流 | `@antv/x6`、Wise workflow runtime |
| 持久化 | SQLite、JSON 文件、事件与运行快照 |

## 开发约定

- 包管理器统一使用 **Bun**，保持 `bun.lock` 为唯一锁文件。
- 前端、Tauri 与指南规范见 `.trellis/spec/`。
- 较大的功能改动应先在 `.trellis/tasks/` 建立或选择任务。
- 推荐使用 VS Code、Tauri 插件和 rust-analyzer。

## 贡献与许可证

欢迎提交 Issue、PR 和使用反馈。项目采用 [Apache License 2.0](LICENSE) 开源。

感谢 [Tauri](https://tauri.app)、[React](https://react.dev)、[Ant Design](https://ant.design)、[Claude Code](https://code.claude.com) 以及所有参与 Wise 演进的贡献者。
