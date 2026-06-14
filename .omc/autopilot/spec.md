# Wise 自动批准（Auto-Approve）模式 — Spec

## 一句话目标
在 Wise 主会话里给用户一枚开关，让 Claude Code 会话不再弹 PermissionDock / QuestionDock，由 Wise 自动应答，让流程完全自动化；不破坏原有手动 dock 路径。

## 现状（已确认事实）
1. **CLI 旗标已经默认开**：`src-tauri/src/claude_commands.rs:1217`、`:1279`、`prd_split.rs:104`、`:248`、`prd_split_pipeline.rs:1224` 全部默认拼了 `--permission-mode bypassPermissions`。所以**工具粒度的权限弹窗在标准模型上已经基本不会出现**。
2. **AskUserQuestion 仍会出现**：模型主动调用，UI 走 `QuestionDock`（`src/components/ClaudeChatInput/dock/question-dock.tsx`），由 `useClaudeSessions.ts:respondToQuestion` 把答案写回 stdin `control_response` 或 resume 续跑。
3. **`can_use_tool` 控制流仍可能出现**：MCP / 插件 / 第三方代理（Qwen 等）有时仍走 `sdk_control_request:can_use_tool` 或 `subtype:permission`，UI 走 `PermissionDock`，由 `respondToPermission` 写回 stdin。
4. **现有键值存储可直接复用**：`set_app_setting` / `get_app_setting` / `get_app_settings_batch`（`app_state_commands/settings_commands.rs:225-266`）支持任意字符串 key/value，**无需迁移、无需新表**。

## 范围
**做：**
- 新增「自动批准」三态开关：`off | edits | all`，全局默认 + 仓库覆盖。
- `auto !== "off"` 时：
  - `PermissionRequest`（`controlSubtype === "can_use_tool"` 或 `"permission"`）由 Wise **自动 allow_once**（不发到 dock）。
    - `edits`：仅 Edit/Write/MultiEdit/NotebookEdit/Update 类工具自动通过；其它仍弹 dock。
    - `all`：全部自动通过。
  - `QuestionRequest`（AskUserQuestion）：
    - `all` 模式下自动选第一项（multiSelect 时全选），customAnswer 留空，复用 `respondToQuestion` 链路。
    - `edits` 模式下不动 question（保留语义：「编辑类自动批准」是 file-write 的范畴，AskUserQuestion 仍由人作答）。
- UI：会话 composer 增加状态徽章；设置入口在「应用设置」对话框（已有的全局设置面板）。
- 对外可观测：Wise 通知中心保留一条「已为你自动批准 X」的紧凑日志（短期 toast），便于审计。

**不做：**
- 不改 `--permission-mode bypassPermissions` 这个 CLI 参数（保留现状）。
- 不删 `PermissionDock` / `QuestionDock`（保留人工兜底，开关 `off` 时与今天行为一致）。
- 不改后端 stream-json 解析（控制流处理仍在前端）。
- 不引入仓库 settings 表的新字段（用 `app_setting` key/value 即可，避开 db 迁移）。
- 不动 PRD split / `--bare` 编排子进程（它们 stdin 关闭，本来就走不到 dock）。

## 配置数据模型
```ts
// 持久化在 app_setting：
//   key  = "auto_approve_mode"            （全局默认；最低优先级）
//   key  = "auto_approve_mode:repo:<id>"  （仓库覆盖；最高优先级）
//   value = "off" | "edits" | "all"
export type AutoApproveMode = "off" | "edits" | "all";
```

读取顺序：仓库级 → 全局默认 → `"off"`。

## 自动批准的判定规则

### `PermissionRequest`
- `mode === "off"` → 行为不变，弹 dock。
- `mode === "all"` → 自动写 `allow_once`（保留 `tool_input` / `tool_use_id`）。
- `mode === "edits"` →
  - `request.tool` ∈ {`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Update`} → 自动 `allow_once`。
  - 其它（含 `Bash`、MCP、`ExitPlanMode`、未知） → 弹 dock。
  - 这一表与 Claude 官方 `acceptEdits` 行为对齐。

### `QuestionRequest`
- `mode === "all"` →
  - `request.options.length === 0` → 不自动应答（避免乱填空白），仍弹 dock。
  - `multiSelect === true` → 自动选**全部** options。
  - `multiSelect === false` → 自动选第一项。
  - `customAnswer = ""`。
  - 复用 `respondToQuestion(sessionId, answers, customAnswer)` 链路。
- 其它模式 → 不自动应答。

## 触发点（前端）
- `notificationHub.setPermissionRequest` 写入 → 在 `useClaudeSessions.ts` 订阅侧拦截一次，判定后要么调 `respondToPermission(sessionId, "allow_once")`、要么不动。
- `notificationHub.setQuestionRequest` 写入 → 同样订阅侧拦截，要么调 `respondToQuestion`、要么不动。
- 两个回调本就 idempotent（hub 内部用 `requestLifecycles` 跟踪），重复调用会走 hub 的去重路径。

## UI
1. **应用设置对话框**：新增「Claude 会话自动批准」一栏，三选一 radio + 短说明 + 警告文案。
2. **仓库设置（可后置）**：仓库设置面板增加「跟随全局 / 覆盖为 …」选项（落 `auto_approve_mode:repo:<id>`）。
3. **Composer 徽章**：当前会话 effective mode 不是 `off` 时，composer 顶部显示 `⚡ 自动批准: 全部` 或 `⚡ 自动批准: 仅编辑`，颜色用 warning。

## 安全/风险
- `mode === "all"` + AskUserQuestion 自动选首项可能让模型自己绕过决策点 → UI 必须可见徽章 + 设置文案明确「自动选第一项可能跳过你想要的二次确认」。
- `mode === "edits"` 与 `bypassPermissions` 叠加后语义为 **"模型可以无询问编辑文件"**，与 Claude Code 官方 `acceptEdits` 模式语义一致。
- 全局开关默认 `off`，必须用户主动开启。

## 验证方式
- 新增前端单测：`autoApproveDecide.test.ts` 验证规则函数正确性（off/edits/all × Permission/Question × 各种 tool / multiSelect 组合）。
- 新增前端单测：`autoApproveSettings.test.ts` 验证仓库覆盖 → 全局 → 默认的优先级。
- 现有 `bunx tsc --noEmit` 通过。
- 现有 `cargo test --lib` 通过（后端零改动，应不受影响）。

## 输出文件清单
- 新建 `src/utils/autoApproveDecide.ts`：纯函数判定。
- 新建 `src/services/autoApproveSettings.ts`：基于 `getAppSetting/setAppSetting` 的读写。
- 改 `src/hooks/useClaudeSessions.ts`：在 PermissionRequest / QuestionRequest 落地后做自动应答。
- 改 `src/components/ClaudeChatInput/composer-region.tsx` 或上层：状态徽章。
- 新建/改设置面板：增加一栏。
- 测试：`src/utils/autoApproveDecide.test.ts`、`src/services/autoApproveSettings.test.ts`。
