# 常用语：全局 + 仓库合并显示

## 背景

当前常用语作用域是「仓库优先 + 全局兜底」（6 天前落地）：
- 仓库有自己的配置 -> **只显示仓库的**，全局被完全屏蔽
- 仓库无配置 -> 回退显示全局
- 首次在仓库编辑时，把全局复制为仓库起点

问题：跨仓库通用的常用语（如 `/autopilot`、提交说明模板）想一次配置到处可用，但当前语义下每个仓库都得手动加一遍，很麻烦。

## 目标

改为「全局 + 仓库合并」：通用短语放全局一次，各仓库自动叠加显示；仓库级只放该仓库特有的。store/service 的 per-scope 持久化不变，改动集中在 hook 编排与 Panel 渲染。

## 关键决策

### D1（需确认）：全局条目在仓库面板的编辑性

推荐 **全局只读**：
- 仓库的「管理常用语」面板里，全局条目只展示，不可编辑/删除/切快捷栏开关
- 要改全局去 左栏 `DefaultConfigPanel` > 「全局常用语」row（`GlobalComposerCommonPhrasesManager`）
- 理由：避免在仓库面板误改全局而影响所有仓库；语义清晰；实现最简单

备选：
- A2 全局可直接编辑：仓库面板里改/删全局条目实际改全局（影响所有仓库）。方便但易误操作。
- A3 全局可被仓库覆盖：全局条目可「克隆」成本仓库副本再改，原全局不动。灵活但多一步，且要处理同 id/chord 覆盖。

下文实现按 D1=全局只读 描述。若选 A2/A3，Panel 的分组交互与 persist 语义需相应调整（实现前确认）。

### D2：合并顺序与 chord 冲突

- 顺序：全局在前 + 仓库在后（「通用 + 本仓库特有」）
- chord 冲突：仓库级优先，全局中与仓库级同 chord 的条目**剥离 chord**（条目保留，仍可点击发送，只是没快捷键）
- id 冲突：全局与仓库级是独立 id 空间（UUID），React key 用 `${source}:${id}` 区分，不改动 phrase.id（dispatch 依赖原 id）

### D3：废弃「首次编辑复制全局」

合并模式下全局本来就显示，不再需要「仓库无配置时首次编辑把全局复制为仓库起点」的语义。移除相关注释/分支。

### D4：上限

`MAX_COMPOSER_COMMON_PHRASES = 24`：
- 各 scope 各自校验（全局 persist <=24，仓库 persist <=24，现有行为）
- 合并后 effective 若超 24，截断仓库级尾部（保留全局全部 + 仓库级前 N）

## 改动清单

### 1. `src/constants/composerCommonPhrase.ts` — 新增 merge 工具

```ts
/** 合并全局 + 仓库级常用语：全局在前，仓库在后；仓库级 chord 优先，全局同 chord 剥离 chord。 */
export function mergeComposerCommonPhrases(
  global: readonly ComposerCommonPhrase[],
  repo: readonly ComposerCommonPhrase[],
): ComposerCommonPhrase[]
```

规则：
- 收集 repo 中所有 chord 到 Set
- 遍历 global：若其 chord ∈ repoChords，剥离 chord 后 push；否则原样 push
- 追加 repo 全部
- `slice(0, MAX_COMPOSER_COMMON_PHRASES)`

新增同文件单测 `composerCommonPhrase.test.ts`：覆盖空、纯全局、纯仓库、chord 冲突剥离、上限截断。

### 2. `src/hooks/useComposerCommonPhrases.ts` — 合并编排

- `effectivePhrases`：
  - `repositoryId == null` -> `globalPhrases`（不变）
  - `repositoryId != null` -> `mergeComposerCommonPhrases(globalPhrases, repoPhrases)`
- `scope` 类型：`"global" | "merged"`（移除 `"repository" | "fallback-global"`）
  - `repositoryId == null` -> `"global"`
  - else -> `"merged"`
- 返回值新增：`globalPhrases`（只读源）、`repoPhrases`（仓库级源，repositoryId==null 时为 `[]`）
- `persist` 不变（仍写当前 scope：repositoryId!=null 写仓库级，null 写全局）
- 移除「首次编辑复制全局」相关注释/逻辑
- `hasRepositoryScope` 保留（Panel 用来决定是否渲染全局只读组）

### 3. `src/components/ClaudeChatInput/ComposerCommonPhrasesPanel.tsx` — 分组渲染

Props 调整：新增 `globalPhrases?: readonly ComposerCommonPhrase[]`（只读源），现有 `phrases` 改为「仓库级可编辑列表」（repositoryId==null 时 `phrases` 即全局、可编辑）。

渲染（`scope === "merged"` 且 `globalPhrases.length > 0` 时）：
- **全局组**（只读）：标题「全局常用语（所有仓库共享）」+ 提示「在 左栏默认配置 > 全局常用语 编辑」。列表项只展示 title/preview/keys/快捷栏状态，禁用编辑/删除/快捷栏 Switch。
- **仓库组**（可编辑）：标题「当前仓库：{basename}」。沿用现有 add/edit/remove/快捷栏 Switch 逻辑，`onPersist` 只作用于这一组。
- 新增按钮上限按仓库组 `phrases.length` 算。

`scope === "global"` 时（即 `GlobalComposerCommonPhrasesManager` 与 repositoryId==null 场景）：保持现有单组可编辑渲染，不变。

`scopeHintFor` 更新：
- `"global"` -> 「全局常用语」
- `"merged"` -> 「全局 + 当前仓库：{name}」

### 4. `src/components/ClaudeChatInput/ComposerCommonPhrasesManageTrigger.tsx`

透传新增 `globalPhrases` prop 到 Panel。Trigger 按钮的计数 badge：用 effective 总数（`globalPhrases.length + phrases.length`）或保持 `phrases.length`（仓库级）。建议用 effective 总数，反映用户实际看到的条数。

### 5. `src/components/ClaudeChatInput/composer-region.tsx`

从 hook 解构 `globalPhrases`、`repoPhrases`，传给 `ComposerCommonPhrasesManageTrigger`：
- `phrases={repoPhrases}`（仓库级可编辑；repositoryId==null 时 hook 让 repoPhrases=[]，此时应 fallback 传 globalPhrases——见下）
- `globalPhrases={globalPhrases}`

repositoryId==null 边界：hook 返回 `repoPhrases=[]`、`globalPhrases=全局`、`scope="global"`。此时 Panel 走 `scope==="global"` 分支，`phrases` 应传 `globalPhrases`（可编辑）。统一规则：Panel 的 `phrases` 传「当前可编辑源」= `scope==="global" ? globalPhrases : repoPhrases`。可在 hook 里加一个 `editablePhrases` 字段直接表达，避免调用方判断。**采用 `editablePhrases`**：hook 返回 `editablePhrases`（= scope==="global" ? globalPhrases : repoPhrases），Panel 的 `phrases` prop 传它。

### 6. `src/components/ClaudeSessions/ClaudeChatQuickActionsChrome.tsx`

quickBar 用 `phrases`（= effective 合并），已通过 `useComposerCommonPhrases({ repositoryId }).phrases` 拿到 effective。无需改，自动跟随合并。确认 `filterComposerCommonPhrasesForQuickBar` 对合并列表正确（按 showInQuickBar 过滤，OK）。

### 7. `src/components/ClaudeChatInput/GlobalComposerCommonPhrasesManager.tsx`

`useComposerCommonPhrases({})` -> scope="global"，editablePhrases=globalPhrases。无需改。

## 不改的部分

- `src/services/composerCommonPhrasesByRepo.ts`：per-repo KV 存储不变
- `src/stores/composerCommonPhrasesStore.ts`：per-scope store 不变（现有 store 测试全部保持通过）
- 跨标签页/窗口同步事件：不变
- 保留键 ⌘I 拒绝：不变

## 测试

- 新增 `mergeComposerCommonPhrases` 单测（constants 层）
- store/service 既有测试不受影响（已核对：`composerCommonPhrasesStore.test.ts`、`composerCommonPhrasesByRepo.test.ts` 都针对 per-scope 持久化，不涉及合并）
- 若存在 hook 测试则更新 scope 断言；grep 未发现 `useComposerCommonPhrases.test.ts`，按需新增合并行为测试
- 手动验证（不启动 dev server，靠静态检查 + 单测）：合并显示、chord 冲突剥离、全局只读、仓库编辑不污染全局

## 风险与回退

- 作用域语义变更是面向用户的行为变化：仓库已有独立配置的用户，原先只看到仓库的，改后会多看到全局叠加。若不希望，可加开关 `composerCommonPhrasesMergeWithGlobal`（默认开），但第一版建议直接合并，观察反馈。
- 回退点：合并逻辑全在 hook 的 `effectivePhrases` 与 merge 函数，回退只需恢复 `effectivePhrases = useRepositoryPhrases ? repoPhrases : globalPhrases`。

## 记忆更新

实现完成后更新 `multipane-per-repo-common-phrases.md`：作用域语义从「仓库优先+全局兜底」改为「全局+仓库合并（全局只读）」，记录 D1-D4 决策。
