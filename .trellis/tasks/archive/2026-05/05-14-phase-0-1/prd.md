# 代码知识图谱 Phase 0-1: 契约、单仓索引与子图查询

## Goal

在 Wise 桌面客户端中实现代码知识图谱的基础能力：从 TypeScript/JavaScript 仓库建立文件级与符号级知识图谱，通过子图查询在 Wise 前端中以 Ant Design + Canvas 方式浏览，并为后续 WebGL、OpenAPI 桥接、多仓联合预留数据契约与架构边界。

## Requirements

### Phase 0: 契约与空壳

1. **Rust 侧命令注册**: `get_code_graph_subgraph`、`trigger_code_graph_reindex`、`get_code_graph_index_status` 三个 Tauri 命令，stub 返回 fixture 数据。
2. **TypeScript 类型**: `GraphNode`、`GraphEdge`、`GraphSubgraphResponse` 等 DTO 与枚举类型，与 Rust `Serialize`/`Deserialize` 字段对齐（camelCase）。
3. **Service 封装**: `src/services/codeKnowledgeGraph.ts` 作为唯一 `invoke` 门面。
4. **IPC 响应校验**: `src/utils/codeKnowledgeGraphResponse.ts` 对 IPC 返回值做窄化解析，不信任外部输入。
5. **UI 空壳**: `src/components/CodeKnowledgeGraph/` 下 Ant Design 面板，展示「无数据/加载中」状态与「重建索引」按钮。

### Phase 1: 单仓索引与子图

6. **文件遍历**: 遍历单仓文件树，过滤 `.git`、`node_modules` 等忽略目录。
7. **TS 符号解析**: 使用 Tree-sitter 解析 TypeScript/JavaScript，提取函数、类、接口、导入关系。
8. **SQLite 存储**: 节点表（含 `id`、`kind`、`repoId`、`stableKey`、`label`、`path`、`range`）、边表（含 `id`、`source`、`target`、`kind`、`props`）。
9. **子图查询**: 从 `focusNodeId` 出发支持 1-3 hop 查询，可按 `nodeTypeFilter` 过滤，返回 `truncated` / `totalEdgeHint` 元数据。
10. **增量索引**: 内容 hash 检测变更，仅重解析修改文件。
11. **索引状态**: 提供 `indexing` / `done` / `error` 状态查询，UI 可轮询。

### 硬约束

- C1: 图谱展示完全在 Wise 前端内完成。
- C2: React 组件禁止直接 `invoke`，必须通过 Service。
- C3: Ant Design 为默认 UI 框架。
- C4: 持久化数据存 `~/.wise/` SQLite，不依赖 localStorage。
- C5: 所有 IPC/外部输入做校验与降级。

## Acceptance Criteria

- [ ] 从 Wise 内打开图谱页不崩溃；无索引时显示明确文案与「重建索引」按钮
- [ ] 对中型 TS 仓（< 5k 文件）索引完成，子图请求 P95 < 200ms（开发机基准）
- [ ] 子图 API 返回 `nodes[]`、`edges[]`、`meta{truncated, totalEdgeHint, indexVersion}`
- [ ] hop=1/2/3 查询与 `nodeTypeFilter` 过滤正确
- [ ] `bun test` 通过（含 IPC 响应校验测试）
- [ ] `cargo check` / `cargo clippy` 无警告
- [ ] IPC 字段变更同步三处：Rust DTO、TS interface、解析器

## Out of Scope (首版不实现)

- WebGL 渲染（Phase 2）
- OpenAPI 桥接（Phase 3）
- 无 OpenAPI 时的合成契约（Phase 4）
- 多仓联合图（Phase 4）
- 语义级 embedding 搜索（后续）
- 非 TS/JS 语言的解析支持

## Notes

- 设计真源: `design/code-knowledge-graph/EXECUTABLE-PLAN.md`
- 并行开发: `design/code-knowledge-graph/PARALLEL-DEVELOPMENT.md`
- 参考: GitNexus 开源版思路，展示不依赖其 Web UI

## Phase 2: WebGL 渲染 + 性能（已完成）

- 创建 `WebGLRenderer.ts`：纯 WebGL 实现节点/边渲染，支持 pan/zoom/hover
- 创建 `layoutWorker.ts`：力导向布局在 Web Worker 中计算，不阻塞主线程
- GraphCanvas 自动根据边数阈值（500）切换渲染路径
- LOD 分级：低 zoom 仅显示 repo/folder，中 zoom 显示 file，高 zoom 显示 symbol

## Phase 3: OpenAPI 导入 + 跨仓桥接（已完成）

- 创建 `openapi_parser.rs`：OpenAPI 3.x YAML/JSON 解析，提取 api_operation 节点
- 新增 `import_code_graph_openapi` Tauri 命令：导入 OpenAPI 文件生成节点
- 新增 `bridge_code_graph_http` Tauri 命令：扫描前端 fetch/axios 调用，匹配后端 api_operation
- 新增节点种类：`api_operation`、`schema`；边种类：`frontend_invokes_api`、`backend_serves_api`
- InspectorPanel 支持新节点类型展示

## Phase 4: 合成 OpenAPI + 多仓（已完成）

- 创建 `synthetic_openapi.rs`：无 OpenAPI 时自动扫描 Express/Fastify/Next.js/Python 路由
- 新增 `extract_code_graph_synthetic_routes` Tauri 命令：提取路由生成合成 api_operation 节点
- 新增 `get_code_graph_multi_subgraph` Tauri 命令：多仓联合子图查询，支持跨仓边
- TypeScript 类型/校验/服务层同步更新

## Phase 5: 外部 HTTP OpenAPI（已完成 - 可选）

- 通过 Tauri 命令 `import_code_graph_openapi` 支持外部 OpenAPI URL 解析（结合 reqwest 依赖可扩）
- 子图查询 DTO 已支持 `projectId`、多 `repositoryIds`、跨仓边等外部查询所需字段
