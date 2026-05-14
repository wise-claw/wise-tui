# feat(code-knowledge-graph): multi-repository knowledge graph with OpenAPI bridging

## Goal

支持选择多个仓库（前端+后端），通过 OpenAPI 桥接关联关系，在统一图谱中展示跨仓库的调用关系

## Requirements

### R1: 多仓库选择
- 面板支持**多选仓库**（至少选择 2 个：前端 + 后端）
- 每个仓库独立索引，索引状态独立展示
- 用户可选择已索引的任意仓库组合

### R2: 联合索引
- 对选中的每个仓库分别执行 `index_repository`
- 所有仓库索引完成后，触发 OpenAPI 桥接（`bridge_code_graph_http`）
- 桥接生成 `frontend_invokes_api` 跨仓库边

### R3: 跨仓库图谱查询
- 使用已有的 `get_code_graph_multi_subgraph` 查询多仓库子图
- 支持 `includeCrossRepoEdges: true` 展示跨仓库边
- 支持 `includeCrossRepoEdges: false` 只看单仓库内部关系

### R4: 图谱可视化
- 不同仓库的节点用不同颜色区分
- 跨仓库边（`cross_repo` / `frontend_invokes_api`）用特殊样式（虚线 / 不同颜色）
- Inspector Panel 展示节点所属仓库信息

### R5: 索引状态管理
- 每个仓库独立显示索引状态（未索引 / 索引中 / 已索引 / 索引失败）
- 支持单独重建某个仓库的索引
- 支持一键重建所有选中仓库的索引 + 重新桥接

## Constraints

1. 复用已有的 `bridge_code_graph_http`、`get_code_graph_multi_subgraph` 等 Tauri 命令
2. 不修改底层存储 schema（已有 `repo_id` 字段和 `cross_repo` 边类型）
3. UI 保持 Ant Design，不改设计系统
4. 前端组件仍通过 `src/services/codeKnowledgeGraph.ts` 门面调用，不直接 `invoke`

## Acceptance Criteria

- [ ] 可选择 ≥2 个仓库，展示每个仓库的索引状态
- [ ] 点击「建立联合图谱」后，对选中仓库逐一索引，完成后自动桥接
- [ ] 图谱中展示跨仓库边，悬停/点击可看到「前端文件 X 调用后端 API Y」信息
- [ ] 节点颜色按仓库区分，跨仓库边样式与普通边不同
- [ ] 重建单仓库索引后，跨仓库边自动重新生成
- [ ] 未选中任何仓库时展示空状态引导

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
