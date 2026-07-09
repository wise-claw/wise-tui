# 流式会话消息装配污染修复（实时乱、刷新后规整）

## 背景与根因

用户报：会话消息列表实时流式渲染时「乱」（总结混入引导语/思考、同段文字重复、顺序穿插、重复助手气泡、工具块与正文错位），手动刷新（重载磁盘 transcript）后规整。

经探索确认：**渲染层是被动展示，根因全在上游消息装配层**。流式实时态（内存）与磁盘重载态（JSONL `blocksToParts` 重建）走不同的 parts 装配路径，前者有多处污染、后者干净 —— 故「刷新后规整」。判别依据：流式期 orphan markdown 渲染被 `ClaudeChatMessageRow.tsx:104` 显式关闭，且 `content` 正常派生自 `parts` 时 orphan 恒空，渲染层不会主动制造重复/穿插。

### 根因 1（表现：同段文字重复，最高频）
- `extractPartsFromParsed`（`src/services/claudeStreamParser.ts:279-293`）的 `result` 事件分支把整段最终文本 `json.result` 作为一条 text part 返回（291 行）。
- 该 part 经 `mergeAssistantParts`（`src/services/claudeStreamAssembler.ts:128-135`）**拼接到 delta 累积的末尾 text part**（131 行 `lastText.text + part.text`），正文翻倍。
- runtime 去重（`claudeStreamRuntime.ts:465-475`）只挡「完全相同 + 1500ms 内」；result 整段与 delta 累积有细微差异或超 1500ms 即失效 → 同段重复。
- 磁盘重载 `blocksToParts` 重建为单 text block、不拼接 → 规整。

### 根因 2（表现：碎裂/穿插）
- `mergeAssistantParts` 把被 reasoning/tool_use 打断的 text 切成多条 part；渲染层每条 text part 一个气泡 → 流式多气泡碎裂；磁盘重载单 text block → 规整。

### 根因 3（表现：总结混入引导语/思考 + 重复助手气泡）
- `appendAssistantPreviewTextMessage`（`src/services/claudeSessionState.ts:159-205`）：
  - 分支 4（189-199）：末条 assistant 有 tool_use 但 `existingPostTool==0` 时，追加 `previewRaw`（=`max(fromRef 含 reasoning/intro, fromMessages, fromAfterFlush)`，`claudeStreamRuntime.ts:665-668`）作 post-tool text part，`content` 也设为 previewRaw → 引导语/思考混入总结。
  - 分支 1（173-178）：末条非 assistant 时新建 assistant 气泡 → 重复气泡。
- streamingResident 走 `skipDiskReload`（`claudeStreamRuntime.ts:760-765`）不自动磁盘重载 → 污染留存到手动刷新。

### 根因 4（表现：工具块与正文错位）
- tool_result fold 时序：流式 `applyToolResultPartsToSession` 按 id fold，tool_use 未到则成 orphan user 行；与磁盘 `foldToolResultUserMessagesIntoAssistant` 路径差异 → 渲染不一致。需进一步确认是否独立可修。

---

## 修复方案（分阶段，P0-P2 必做，P3-P4 默认不做）

### P0：result 事件不与 delta 累积拼接（根因 1，核心）
**目标**：消除「同段文字重复」最高频根因。

**改点**：
1. `src/services/claudeStreamParser.ts` `extractPartsFromParsed`：返回值增加 `isResultFullText: boolean`，result 事件分支（291 行）置 true（其余分支 false）。同步更新返回类型与薄包装 `extractPartsFromStreamLine`。
2. `src/services/claudeStreamRuntime.ts`：`applyOutputLine` 取出 `isResultFullText`；`buildStreamSessionUpdater`（或其调用处）当 `isResultFullText && dedupedParts` 全为 text、且目标末条 assistant 已有 text part 时，**跳过** `appendAssistantStreamParts` 注入（delta 已覆盖正文，result 是权威重复）；末条无 text part 时才注入兜底防闪空。result 文本仍照常累积进 `assistantStreamTextByTabRef` 缓冲与 complete 的 `previewRaw`。
3. 单测：result 整段到达、末条已有 delta text part → 不拼接、内容不翻倍。

**风险**：低-中。跳过前提是「末条已有 text part」；若 delta 累积不完整（少几字符），跳过后用不完整 delta，但 complete 后非 streamingResident 会磁盘重载修正；streamingResident 残留少几字符（远好于内容翻倍）。

### P1：mergeAssistantParts 前缀包含去重（根因 1 加固）
**目标**：兜住 P0 未覆盖的「相邻 text part 前缀包含」重复。

**改点**：
1. `src/services/claudeStreamAssembler.ts` `mergeAssistantParts`（128-135）：text 合并前，若 `incoming.text` 与末尾 text 存在前缀/包含关系（互为前缀或相等），用更长者替换末尾，而非拼接；否则保持原拼接逻辑（增量 delta）。
2. 单测：前缀包含用例（相等/前缀/后缀/无关）。

**风险**：低。纯合并策略增强，不改 parts 结构。

### P2：appendAssistantPreviewTextMessage 兜底加固（根因 3）
**目标**：complete 兜底不再用整轮 previewRaw 污染总结、不再重复建气泡。

**改点**：
1. `src/services/claudeSessionState.ts` `appendAssistantPreviewTextMessage`：
   - 分支 4（189-199）：末条 assistant 已有**任何** text part（含 intro）时不追加 previewRaw（已有可见内容，不污染）；仅当无任何 text part 时才追加兜底。
   - 分支 1（173-178）：末条非 assistant 时 `return session`（不新建气泡，依赖磁盘重载/已有内容），避免重复气泡。
2. `src/services/claudeSessionState.preview.test.ts`：补用例 —— 末条有 intro text part 时不追加 previewRaw；末条非 assistant 时不新建气泡。

**风险**：低-中。分支 1 收紧后，极少数「末条非 assistant 且无任何 assistant 气泡」场景会暂时无总结气泡，但 complete 后磁盘重载补齐（非 streamingResident）；streamingResident 会走 P0 的 result 文本兜底。

### P3（可选，默认不做）：result 重建 text parts（根因 2 彻底）
result 到达时把末条 assistant 所有 text part 合并替换为单条 resultText（保留 reasoning/tool_use 位置），与磁盘 `blocksToParts` 一致，消除流式碎裂。**风险中**（改变 parts 结构可能影响渲染顺序与其他依赖），P0+P1 修好重复后碎裂只是多气泡、非内容错乱，故默认不做。

### P4（可选，默认不做）：tool_result fold 时序（根因 4）
流式与磁盘 fold 行为对齐。需先调查 `applyToolResultPartsToSession` 与 `foldToolResultUserMessagesIntoAssistant` 的 orphan 处理差异，风险待评估，默认不做。

---

## 验证（不跑 dev/build，依项目规则）

1. `bun test src/services/claudeSessionState.preview.test.ts` —— P2 新增用例 + 既有用例全过。
2. 相关 stream assembler/parser/runtime 单测 —— P0/P1 新增用例全过。
3. `bun test` 全量回归 —— 对照记忆 `test-baseline-failures.md` 既有基线失败，确认无新增回归。
4. tsc 类型检查 —— `extractPartsFromParsed` 返回类型扩展、`mergeAssistantParts` 签名不变，类型干净（排除 main 既有 tsc 基线错误）。
5. 手动 QA（用户跑）：长会话多轮工具调用 → 实时渲染无同段重复、无引导语混入总结、无重复气泡；刷新后与实时一致。

## 改动文件清单

- `src/services/claudeStreamParser.ts`（P0：`extractPartsFromParsed` 返回 `isResultFullText` + 类型）
- `src/services/claudeStreamRuntime.ts`（P0：result 跳过注入逻辑）
- `src/services/claudeStreamAssembler.ts`（P1：`mergeAssistantParts` 前缀包含去重）
- `src/services/claudeSessionState.ts`（P2：`appendAssistantPreviewTextMessage` 分支 1/4 收紧）
- `src/services/claudeSessionState.preview.test.ts`（P2：新增用例）
- stream assembler/parser 相关单测（P0/P1：新增用例）
