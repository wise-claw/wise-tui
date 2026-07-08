# 会话消息列表展示梳理优化

## 背景

对中栏 Claude 会话消息列表的「展示合理性」做梳理优化。经探索已校准四个方向的真实改点（修正了初版探索的几处过时判断）：

- `app-tool-output-markdown` **已有** `max-height: 240px`（index.css:5676-5692），并非无封顶。
- 用户消息**已有** 2px primary 左边框 + 22% primary-bg + 圆角（index.css:9346-9352），区分并非缺失。
- chat/monitor 变体都传 `inlinePendingHint={false}`（ClaudeChatMessageRow.tsx:108、ClaudeSessionMonitorMessageRow.tsx:58），part 内 `StreamingReplyHint` 在列表中永不触发，「思考重复」实为「reasoning 预览 + 底部 thinking-hint」叠加。

主样式文件：`src/components/ClaudeSessions/index.css`。行号均基于当前 HEAD。

---

## 方向 1：错误消息可识别性（低风险）

**问题**：系统级错误消息（`isErrorNotice` 命中「错误:/发送失败:/启动失败:」前缀）仅 `color: error; font-weight: 500`（index.css:4063-4067），无背景/边框/图标，在对话流中极易被忽略。对比工具失败有 `fail-chip`（error-bg + error-border，9230-9240）+ `tool-error`（2px error 左边框，9242-9244），系统级错误反而更弱。

**改点**：
1. `src/components/ClaudeSessions/SystemMessageContent.tsx`：`error` 为 true 时，在 Markdown 之前渲染一个错误图标（内联 SVG，与现有 MessageParts 的 SVG 风格一致），并套用 `app-system-message--error` 类（已有）。
2. `src/components/ClaudeSessions/index.css` `.app-system-message--error`（4063-4067）：加 `background: var(--ant-color-error-bg)` + `border-left: 2px solid var(--ant-color-error-border)`（对齐 `.app-message-part--tool-error`）+ `border-radius: 0 6px 6px 0` + `padding: 6px 10px`，让系统级错误与工具失败风格一致。
3. 不改 `isErrorNotice` 判定（保持现有前缀匹配）。

**风险**：极低。纯视觉增强，不改判定逻辑。

---

## 方向 2：工具输出高度收敛（低风险）

**问题**：折叠态工具卡 subtitle（`app-message-part-subtitle`，index.css:5216-5228）用 `white-space: pre-wrap`，bash command subtitle 上限 2000 字（MessageParts.tsx:343），折叠态会换行撑高、破坏紧凑性。展开态 5040-5045 已用 `!important` 放开为 `normal`——设计意图是「折叠截断、展开放开」，但折叠态写成了 `pre-wrap`（疑似遗漏）。

**改点**：
1. `src/components/ClaudeSessions/index.css` `.app-message-part-subtitle`（5216-5228）：折叠态改为单行截断——`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`（父级 `.app-message-part-header__main` 已是 column flex + `width:100%`，ellipsis 可生效）。展开态 5040-5045 已用 `!important` 放开为 `normal`，完整命令仍可见。
2. 不动 `pickInputString` 的 2000 字上限（展开态「完整命令」`app-tool-expanded-input-code` 需要完整内容）。
3. 不动 `app-tool-output-markdown` 的 240px（已收敛，CLI 180px / Markdown 240px 的差异可接受）。

**风险**：低。折叠态从换行变单行截断，悬浮 `title` 仍展示全文（MessageParts.tsx:761），信息不丢失。

---

## 方向 3：思考过程去重（中风险）

**问题**：末条 assistant 流式输出、且最后一个可渲染 part 是 reasoning（非空）时，reasoning 卡片（紫色描边 + 「思考过程 N字」+ 流式预览）已是明确的「正在思考」指示，底部又叠 `thinking-hint` 行（`StreamingReplyHint`，「正在思考」脉冲），视觉重复。

**改点**：
1. `src/utils/claudeChatMessageListRows.ts` `shouldShowListEndThinkingHint`（37-47）：新增判定——末条为 assistant 且其最后一个**可渲染** part 是 `reasoning` 且该 reasoning 文本非空时，返回 `false`（不追加底部 hint）。其余场景保留：末条 user、末条 assistant 最后 part 是 text/tool_use、reasoning 为空（刚启动）。
   - 用 `isRenderableMessagePart`（claudeChatMessageDisplay.ts:112）取末条 `msg.parts` 过滤后的最后一个，确保与 `MessagePartsDisplay` 渲染一致。
2. `src/utils/claudeChatMessageListRows.test.ts`：补三个用例——末条 reasoning 非空 → 不显示 hint；末条 reasoning 为空 → 显示 hint；末条 text → 显示 hint。
3. tail-patch 快路径（`tryPatchChatMessageListRowsTail`）不受影响：hint 是独立 row，`showListEndThinkingHint` 由 `useChatMessageListRows` 在 build/patch 入口统一计算。

**风险**：中。需保证 reasoning 为空（刚启动、还没输出思考内容）时仍显示底部 hint，否则用户看不到任何「思考中」指示。单测覆盖该边界。

---

## 方向 4：角色区分与阅读宽度（高风险 → 保守执行）

**问题**：`.app-claude-messages`（3621）无 max-width，`.app-claude-message-content`（3896）`width:100%`，单窗全屏时单行文本过长影响可读性。助手正文（4448-4451）完全透明无边框。

**现状澄清**：用户气泡已有 2px primary 左边 + 22% primary-bg + 圆角（9346-9352），角色区分并非缺失——用户有色块、助手靠头像「C」+ sender「Claude」+ 透明正文区分。给助手正文加底色/边框会改变整体扁平风格，风险高、收益低。

**改点（保守必做）**：
1. `src/components/ClaudeSessions/index.css` `.app-claude-messages-virtual-row`（3736-3741）：加 `max-width: 960px; margin-left: auto; margin-right: auto`，超宽窗格下消息列居中、限制单行文本长度。多屏窄窗格（< 960px）不生效，安全；不影响现有气泡风格、贴底跟随、scrollHeight（行 wrapper 改变宽度，滚动容器仍是 `.app-claude-messages`）。

**止步项（默认不做）**：
- 不给助手正文加底色/边框容器（风险高，且现状角色区分已存在）。若批准时希望增强，再单独评估。

**风险**：阅读宽度上限本身低风险（多屏窄窗格不生效）。需手动 QA：单窗全屏消息列居中、多屏窄窗格不受影响、贴底跟随正常。

---

## 验证（不跑 dev/build，依项目规则）

1. `bun test src/utils/claudeChatMessageListRows.test.ts`——方向 3 新增用例 + 既有用例全过。
2. `bun test`——全量回归，对照记忆中的既有基线失败（test-baseline-failures.md），确认无新增回归。
3. tsc 类型检查——`shouldShowListEndThinkingHint` 签名扩展后类型干净（排除 main 既有 tsc 基线错误）。
4. 手动 QA（用户跑）：错误消息样式、折叠态 subtitle 单行截断、末条 reasoning 时底部无重复 hint、单窗全屏阅读列居中。

## 改动文件清单

- `src/components/ClaudeSessions/SystemMessageContent.tsx`（方向 1：错误图标）
- `src/components/ClaudeSessions/index.css`（方向 1/2/4：错误样式、subtitle 截断、阅读列）
- `src/utils/claudeChatMessageListRows.ts`（方向 3：`shouldShowListEndThinkingHint` 扩展）
- `src/utils/claudeChatMessageListRows.test.ts`（方向 3：新增用例）
