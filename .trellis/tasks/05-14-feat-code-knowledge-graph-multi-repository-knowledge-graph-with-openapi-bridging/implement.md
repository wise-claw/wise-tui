# Implementation Plan

## Phase 1: 新建 Hook — `useMultiRepoGraph`

- [ ] 新建 `src/hooks/useMultiRepoGraph.ts`
- [ ] 实现 `selectedRepoIds` 状态管理
- [ ] 实现 `indexAll()` — 串行索引每个仓库
- [ ] 实现 `indexOne(repoId)` — 单仓库索引 + 轮询
- [ ] 实现 `bridge()` — 当选中 2 个仓库时调用 `bridgeCodeGraphHttp`
- [ ] 实现 `fetchSubgraph()` — 调用 `getCodeGraphMultiSubgraph`
- [ ] 实现清理逻辑（组件卸载时停止轮询）
- [ ] 验证：`bun run tsc --noEmit`

## Phase 2: 改造 `CodeKnowledgeGraphPanel`

- [ ] 修改 Props：`repositoryId` → `selectedRepoIds: number[]`
- [ ] 仓库选择器改为多选（`<Select mode="multiple">`）
- [ ] 索引状态区域：每个仓库一行显示状态 + 重建按钮
- [ ] 「建立联合图谱」按钮（选中 ≥2 时显示）
- [ ] 「仅查看内部关系」开关（控制 `includeCrossRepoEdges`）
- [ ] 使用 `useMultiRepoGraph` hook 替代原有状态逻辑
- [ ] 空状态引导（未选仓库 / 只选 1 个）
- [ ] 验证：`bun run tsc --noEmit`

## Phase 3: 改造 `GraphCanvas` — 多仓库可视化

- [ ] 节点颜色按 `node.repoId` 区分（生成颜色映射）
- [ ] 跨仓库边样式：`cross_repo` / `frontend_invokes_api` 用虚线
- [ ] 添加图例组件（Legend）：颜色-仓库映射 + 边类型说明
- [ ] WebGLRenderer 支持边的 `dashed` 属性
- [ ] 验证：`bun run tsc --noEmit`

## Phase 4: 改造 `InspectorPanel`

- [ ] 节点详情中展示所属仓库名称
- [ ] 跨仓库节点展示桥接信息（调用路径、HTTP 方法）
- [ ] 验证：`bun run tsc --noEmit`

## Phase 5: 更新父组件

- [ ] 修改 `AppImpl.tsx` 中 `codeKnowledgeGraphProps` 的构造
  - 新增 `selectedRepoIds` state
  - 新增 `onToggleRepo` callback
- [ ] 修改 `AppWorkspaceLayout.tsx` 类型声明
- [ ] 验证：`bun run tsc --noEmit`

## Validation

- [ ] `bun run tsc --noEmit` — 无类型错误
- [ ] `bun test` — 现有测试通过
- [ ] `bun run tauri:dev` — 手动验证：
  - 选择 2 个仓库 → 索引 → 桥接 → 展示跨仓库边
  - 选择 1 个仓库 → 空状态引导
  - 重建单仓库索引 → 跨仓库边自动刷新
  - 切换 `includeCrossRepoEdges` 开关 → 边显示/隐藏

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useMultiRepoGraph.ts` | **新建** — 多仓库索引编排 hook |
| `src/components/CodeKnowledgeGraph/CodeKnowledgeGraphPanel.tsx` | 改写 — 多选仓库、联合索引控制 |
| `src/components/CodeKnowledgeGraph/GraphCanvas.tsx` | 改写 — 多仓库颜色 + 图例 |
| `src/components/CodeKnowledgeGraph/WebGLRenderer.ts` | 小改 — 支持虚线边 |
| `src/components/CodeKnowledgeGraph/InspectorPanel.tsx` | 小改 — 展示仓库信息 |
| `src/components/CodeKnowledgeGraph/CodeKnowledgeGraphPanel.css` | 小改 — 新样式 |
| `src/AppImpl.tsx` | 小改 — 传递新 props |
| `src/components/AppWorkspaceLayout.tsx` | 小改 — 类型扩展 |

## Notes

- Rust 端无需改动（已有 `bridge_code_graph_http`、`get_code_graph_multi_subgraph`）
- 索引串行执行，避免 SQLite 写入竞争
- 最多选择 5 个仓库（硬编码限制）
