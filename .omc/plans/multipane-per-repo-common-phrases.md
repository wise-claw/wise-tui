# 多屏 per-仓库常用语

## 目标
多屏下每个 pane 的快捷栏（及 composer footer）显示各自会话所属仓库的常用语；仓库无配置时回退全局。底部「管理常用语」按钮编辑当前仓库，全局常用语在默认配置面板管理。

## 现状
- 常用语 = `ComposerCommonPhrase[]`，存在全局 app setting `wise.defaultConfig.v1.composerCommonPhrases`。
- `composerCommonPhrasesStore`（单例全局外部 store）+ `useComposerCommonPhrases()`（无参）。
- 两个展示点都读全局：
  - 快捷栏 `ClaudeChatQuickActionsChrome` → `ComposerCommonPhrasesBar variant="quickBar"`。
  - composer footer `composer-region.tsx` → `ComposerCommonPhrasesManageTrigger` + `ComposerCommonPhrasesBar`。
- 多屏下每个 pane 的 chrome / composer-region 已 per-pane（各有 `session`/`gitRepositoryPath`），但 phrases 共享全局。
- `ClaudeChat` 已有 `sessionRepository`（从 `repositories` find 出，含 `.id`）。
- `ComposerCommonPhrasesPanel` 已透传 `repositoryPath`（仅展示，未 per-仓库存储）。
- `DefaultConfigPanel` 的"常用语"只是 chrome 开关，**不管理 phrases 内容**——全局常用语目前只有 composer 底部按钮一个编辑入口。
- per-仓库 KV 先例：`repositoryRunCommandRowActionPreference` 用 `Record<number, ...>` 按 repositoryId 分桶存 app setting。

## 决策（已与用户确认）
- 作用域语义：**仓库优先 + 全局兜底**。仓库有自己的 phrases → 只显示仓库的；仓库无配置 → 显示全局（只读 fallback，不写入仓库）。首次编辑某仓库时以当前 effective phrases（可能是全局）为起点写入仓库 scope。
- 编辑入口：composer 底部按钮 = 当前仓库；全局常用语在「默认配置面板」单独管理（需新增 UI）。

## 实现步骤

### 1. 数据层：per-仓库存储 service
新增 `src/services/composerCommonPhrasesByRepo.ts`：
- app setting key `wise.composer.commonPhrasesByRepo.v1`，value `Record<number, ComposerCommonPhrase[]>`（key=repositoryId）。
- 函数：`loadComposerCommonPhrasesByRepoMap()`、`loadComposerCommonPhrasesForRepo(id)`、`saveComposerCommonPhrasesForRepo(id, phrases)`、`deleteComposerCommonPhrasesForRepo(id)`。
- 复用 `normalizeComposerCommonPhrases`、`isReservedComposerChord`（与全局一致）。
- chord 跨 scope 唯一性：保存仓库 phrases 时，校验 chord 不与全局及其它仓库冲突；冲突时参考现有 `stripComposerChordFromPeers` 剥离逻辑，`message.warning` 提示。
- 复用 `getAppSetting`/`setAppSetting`（与先例一致）。

### 2. store：按 scope 分桶
改造 `src/stores/composerCommonPhrasesStore.ts`：
- 内部 `Map<scopeKey, ScopeState>`，scopeKey = `"global"` | `repo:<id>`，每个 ScopeState 独立 `{ phrases, generation, listeners, loaded, loadPromise, loading, saving }`。
- 暴露 `getComposerCommonPhrasesStore(scope: { repositoryId?: number | null })` 返回该 scope 的 `{ subscribe, getSnapshot, getPhrases, ensureLoaded, persist, addPhrase, updatePhrase, removePhrase, getLoading, getSaving }`。
- global scope 复用现有 `loadComposerCommonPhrasesFromStore`/`saveComposerCommonPhrasesToStore`；repo scope 用新 service。
- 保留 `composerCommonPhrasesStore` 导出（= global scope）向后兼容。
- 事件 `WISE_COMPOSER_COMMON_PHRASES_CHANGED` detail 增加 `scope`/`repositoryId`。

### 3. hook：仓库优先 + 全局兜底
改 `src/hooks/useComposerCommonPhrases.ts`：
- 签名 `useComposerCommonPhrases({ repositoryId }: { repositoryId?: number | null } = {})`。
- 取 repo scope store；若 repositoryId 提供，加载仓库 phrases。
- **fallback**：仓库 scope 加载完成且 phrases 为空 → effectivePhrases = 全局 phrases（订阅全局 store 保证同步）；否则 effectivePhrases = 仓库 phrases。
- 返回新增 `scope: "repository" | "fallback-global" | "global"`，供 UI 提示。
- `persist`/`addPhrase`/`updatePhrase`/`removePhrase`：基于 repositoryId 决定写入 repo scope（首次写入时以 effectivePhrases 为起点）或 global scope。
- chord 唯一性由 store/service 层校验。

### 4. 快捷栏
- `ClaudeChat.tsx`（line 1717）：传 `repositoryId={sessionRepository?.id ?? null}` 给 chrome。
- `ClaudeChatQuickActionsChrome`：新增 prop `repositoryId`，`useComposerCommonPhrases({ repositoryId })`，透传 effectivePhrases 到 `ComposerCommonPhrasesBar`。

### 5. composer footer
- `ClaudeChat.tsx`：把 `sessionRepository?.id ?? null` 传给 composer-region（新增 prop `repositoryId`）。
- `composer-region.tsx`：`useComposerCommonPhrases({ repositoryId })`，把 effectivePhrases/scope/persist 传给 `ComposerCommonPhrasesManageTrigger`→`ComposerCommonPhrasesPanel`。

### 6. 管理面板
- `ComposerCommonPhrasesPanel`：接收 `scope`/`repositoryPath`，标题区显示"当前仓库：{name}"（scope=repository）或"全局常用语"（scope=global），并在 fallback-global 时提示"该仓库尚未自定义，当前显示全局常用语，编辑将创建仓库独立配置"。
- 编辑操作走当前 scope 的 persist。

### 7. 全局管理入口（DefaultConfigPanel）
- 在 `DefaultConfigPanel` 新增"全局常用语"管理区：用 `useComposerCommonPhrases()`（无 repositoryId）渲染 `ComposerCommonPhrasesPanel`（或精简版），作为全局兜底 phrases 的编辑入口。
- 不删除既有 chrome 开关（"常用语" 显示开关保留）。

### 8. 测试
- `composerCommonPhrasesByRepo` service：load/save/normalize/chord 冲突单测。
- store：per-scope 隔离、fallback 逻辑单测。
- 既有 `useComposerCommonPhrases` 测试（若有）补充 repositoryId 场景。

## 约束遵守
- 仅 Bun；不跑前端 dev/build（用 `bunx tsc -p tsconfig.app.json --noEmit` + `bun test` 静态验证）。
- 不删除既有功能：全局常用语存储/store/入口全保留，per-仓库是叠加层。
- Ant Design（沿用现有组件）。
- 英语 Conventional Commits；中文注释。

## 风险
- chord 跨 scope 冲突：全局和仓库可能定义相同 chord。需在保存时跨 scope 校验并提示。方案：保存仓库 phrases 时拉取全局 + 所有仓库 map 做冲突检查。
- store 改造范围较大：单例 → scope 分桶，需保证 global scope 行为完全向后兼容（无 repositoryId 调用方不受影响）。
- composer-region 的 `useComposerCommonPhrases` 当前无参，多处调用需统一传 repositoryId。
