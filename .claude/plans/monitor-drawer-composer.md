# 派发任务 drawer「继续会话」输入框改造为与主输入框一致

## 目标
把 `MonitorDrawerSessionComposer`（派发任务侧边栏 drawer 里的「继续会话」输入框）从 antd `TextArea` + Button，改造为与外部主输入框同源的 Semi `AIChatInput` 富文本编辑体验；发送链路不变。

## 现状
- drawer 输入框：`src/components/ProgressMonitorPanel/MonitorDrawerSessionComposer.tsx`（antd `Input.TextArea` + Button，109 行）。发送走 `onResumeSession({ sessionId, prompt, repositoryPath, repositoryDisplayName, taskLabel })` → `resumeSessionFromMonitorDrawer` → `executeSession`，prompt 为纯文本。
- 外部主输入框：`src/components/ClaudeChatInput/composer-region.tsx`（3484 行，耦合 question/permission/followup/revert dock、语音、模型选择、执行环境、pending 队列、`buildClaudeComposerSendPayload` 图片落盘、`onExecute` 复杂签名）。强依赖完整真实 `ClaudeSession`，**不可直接复用**。
- 已有轻量封装：`src/components/ClaudeChatInput/composerPlainEditSurface.tsx`（Semi `AIChatInput` 受控封装，引入 `composer-semi-tokens.css` 共享主题、`composerTokenHighlightExtensions` token 高亮、内置 `SlashPopover` 提供 `@`提及/`/`斜杠触发）。已在 `src/components/ClaudeSessions/PendingTaskQueuePanel.tsx:331` 复用（侧栏轻量输入场景，同构）。

## 方案：复用 ComposerPlainEditSurface + 小幅扩展发送能力

### 1. 扩展 `ComposerPlainEditSurface`（加可选发送能力，不破坏现有用法）
- 新增可选 props：`onSend?: (plain: string) => void`、`canSend?: boolean`（默认 `false`）
- 透传给 Semi `AIChatInput`：
  - `canSend={canSend ?? false}`
  - `onMessageSend={onSend ? (msg) => onSend(normalizeComposerEditorPlain(contentsToPlain((msg.inputContents ?? []) as Content[]))) : undefined}`
- `renderActionArea` 仍 `() => null`（隐藏 Semi 自带发送按钮，由调用方自置按钮）
- `PendingTaskQueuePanel` 不传新 props → 行为零变化

### 2. 改造 `MonitorDrawerSessionComposer`
- 用 `<ComposerPlainEditSurface>` 替换 `Input.TextArea`：
  - `value={draft}` / `onChange={setDraft}`
  - `onSend={handleSend}` / `canSend={canSend}`
  - `repositoryPath={resumeContext?.repositoryPath ?? session?.repositoryPath}`（启用 `@`文件 / `/`斜杠）
  - `employeeMentions={[]}` / `teamMentions={[]}`（drawer 不派发员工/团队，`@`仅触发文件/斜杠，避免在「继续会话」里误派发）
  - `placeholder={disabledReason?.trim() || "输入消息以继续该会话…"}`
  - `className="app-monitor-panel__drawer-composer-surface"`
- 保留外置 antd 发送按钮（"继续会话" + `SendOutlined` + loading/disabled），`onClick` 调 `handleSend`
- 保留 `handleSend` 逻辑：`onResumeSession({ sessionId, prompt: draft.trim(), repositoryPath, repositoryDisplayName, taskLabel })` + 成功后 `setDraft("")`；`ok === false` 时 `message.warning`
- 删除 `onPressEnter`（Enter 发送改由 Semi `onMessageSend` 承担，与主输入框一致：Enter 发送、Shift+Enter 换行）
- 保留 `disabledReason`/`blocked`/`sending` 语义：`blocked` 时 `canSend=false`，外层加禁用样式

### 3. CSS 微调（`src/components/ProgressMonitorPanel/index.css`）
- `.app-monitor-panel__drawer-composer` 保留容器样式（border-top/padding/背景）
- 新增 `.app-monitor-panel__drawer-composer-surface`：Semi 输入框在 drawer 内尺寸适配（minHeight、与主输入框一致的圆角/边框）
- `blocked` 时 `pointer-events:none;opacity:.6` 禁用交互（通过外层 className 控制）

### 4. 不改动
- hook 层发送链路（`resumeSessionFromMonitorDrawer` → `executeSession`）零改动，prompt 仍为纯文本
- 不引入 dock/语音/模型/队列/pending（drawer 无上下文，不在范围）
- 不引入图片附件（需改发送链路，风险高，不在范围）

## 验证
- `bunx tsc --noEmit` 无新错（静态类型检查，不启动 dev server）
- `bun test`：现有 composer 相关测试（`composer-plain-utils.test` / `composerSetContentGuard.test` / `composer-region-races.test`）不回归
- 手动：打开派发任务 drawer → 输入文本 → `@`文件 / `/`斜杠触发 → Enter 发送 → Shift+Enter 换行 → 发送后输入框清空 → 发送按钮 loading/禁用态 → `disabledReason` 时禁用

## 风险与回退
- Semi `onMessageSend` 发送后清空依赖受控 `value=""` 回写 `setContent("")`（`ComposerPlainEditSurface` 已有 `ignoreNextContentSyncRef`/`scheduleComposerSetContent` 机制）；`handleSend` 内 `setDraft("")` 兜底
- Semi `AIChatInput` 在 drawer 760px 宽度下样式异常 → CSS 微调
- 回退：`git revert` 改动文件即可（改动仅 3 文件：`composerPlainEditSurface.tsx`、`MonitorDrawerSessionComposer.tsx`、`index.css`）

## 可选扩展（不在本次范围，需用户确认后再做）
- `@`员工/团队提及（需 drawer 注入 `employeeMentions`/`teamMentions` 并评估与派发任务的串扰）
- 图片附件（需扩展 `resumeSessionFromMonitorDrawer` 支持图片落盘 `buildClaudeComposerSendPayload`）
- 草稿持久化（`PromptProvider` + `draftBucketKey`）
