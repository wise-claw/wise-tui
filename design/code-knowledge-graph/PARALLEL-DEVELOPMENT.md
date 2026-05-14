# 代码知识图谱：并行开发方案

本文档与 [EXECUTABLE-PLAN.md](./EXECUTABLE-PLAN.md) 配套，定义 **多轨道并行** 的边界、契约与合并顺序，避免多人编辑同一热文件冲突。

## 1. 已落地的共享契约（所有轨道依赖）

| 产物 | 路径 | 说明 |
|------|------|------|
| IPC 命令（stub） | `src-tauri/src/code_knowledge_graph.rs` | `get_code_graph_subgraph`、`trigger_code_graph_reindex`、`get_code_graph_index_status` |
| 命令注册 | `src-tauri/src/lib_impl.rs` | `generate_handler!` 已挂接 |
| TS 类型 | `src/types/codeKnowledgeGraph.ts` | 与 Rust `camelCase` 对齐 |
| Service | `src/services/codeKnowledgeGraph.ts` | 唯一 `invoke` 入口 |
| IPC 响应校验 | `src/utils/codeKnowledgeGraphResponse.ts` | 不信任 IPC 时的窄化解析 |
| UI 壳 | `src/components/CodeKnowledgeGraph/CodeKnowledgeGraphPanel.tsx` | Wise 内叠层入口（侧栏「图谱」） |
| 设计真源 | `design/code-knowledge-graph/EXECUTABLE-PLAN.md` | 行为与阶段以文档为准，代码迭代时同步 §5 |

**合并纪律**：改 DTO 时 **同一 PR** 内必须同时改 Rust `Serialize`/`Deserialize`、TS 类型、`codeKnowledgeGraphResponse.ts` 与相关测试。

---

## 2. 并行轨道划分

### Track A — 索引与存储（Rust，可独占 `src-tauri/src/code_knowledge_graph/` 子目录）

- **职责**：`wise_db` 迁移、节点/边表、文件遍历、增量索引任务、子图 hop 查询（替换 stub 实现）。
- **勿改**：`lib_impl.rs` 中除 `generate_handler` 一行注册外的无关命令（减少冲突）。
- **依赖契约**：`CodeGraphSubgraphRequest` / `CodeGraphSubgraphResponse` 字段名稳定；`index_version` 语义由本轨道定义。
- **验收**：单仓 fixture 索引后，`get_code_graph_subgraph` 返回非空节点（或文档约定下的最小图）。

### Track B — OpenAPI 与桥接（Rust 或 TS 纯解析 + Rust 落库，建议新建 `src-tauri/src/code_knowledge_graph/openapi_bridge.rs`）

- **职责**：解析 OAS3、合成契约、生成 `api_operation` 与跨仓边（见 EXECUTABLE-PLAN §6）。
- **依赖**：Track A 的存储表或中间层写入 API。
- **验收**：前后端 fixture 项目出现 `frontend_invokes_api` 类边（边 `kind` 与文档一致）。

### Track C — WebGL 画布与布局（前端，可独占 `src/components/CodeKnowledgeGraph/canvas/`）

- **职责**：sigma/cytoscape/自研 WebGL 选型与集成、LOD、Worker 布局；**不**在组件里写 `invoke`。
- **依赖**：`getCodeGraphSubgraph` 返回数据；可选消费 `parseCodeGraphSubgraphResponse`。
- **验收**：≥1 万边 **子图** 在 Wise 内可缩放平移（FPS 目标见 EXECUTABLE-PLAN）。

### Track D — Inspector 与项目上下文（前端，`CodeKnowledgeGraphInspector*.tsx`）

- **职责**：节点详情、OpenAPI 片段、多仓 `Project` 上下文切换 UI；Ant Design。
- **依赖**：Track A/B 提供的节点 `payload` 字段（后续扩展时走版本字段或 `extras` map）。

### Track E — 产品入口与状态机（`AppImpl.tsx` / `AppWorkspaceLayout.tsx` / `LeftSidebar*`）

- **职责**：模式位与其它叠层互斥、快捷键（可选）、设置项里配置 OpenAPI 路径（后续）。
- **现状**：已提供 `codeKnowledgeGraphMode` + 侧栏「图谱」入口；后续尽量把逻辑抽到 hook 以减少 `AppImpl` 膨胀。

---

## 3. 建议合并顺序（减少 rebase）

1. **契约 PR**（已完成基线）：Rust stub + TS types + service + `parseCodeGraphSubgraphResponse` + 空面板 + 入口。  
2. **Track A** 合并：真实索引 + 子图查询（前端可不换接口）。  
3. **Track C** 与 **Track D** 可并行，基于 stub 数据先画静态/随机图联调，再接真实子图。  
4. **Track B** 在 A 有表后合并。  
5. **Track E** 小步：仅互斥与入口时序，避免与 A/C 同时大改 `AppWorkspaceLayout`。

---

## 4. 每日站会可步进检查项

- [ ] `bun test` 通过（含 `codeKnowledgeGraphResponse.test.ts`）  
- [ ] `cargo check` / `cargo clippy`（Rust 轨道）  
- [ ] IPC 字段变更已同步三处：Rust DTO、TS interface、解析器  

---

## 5. 文件所有权（避免冲突）

| 目录/文件 | 主责轨道 |
|-----------|----------|
| `src-tauri/src/code_knowledge_graph*.rs` | A（B 可拆子模块） |
| `src/services/codeKnowledgeGraph.ts` | 共享（小改协调） |
| `src/types/codeKnowledgeGraph.ts` | 共享（契约变更走小 PR） |
| `src/utils/codeKnowledgeGraphResponse.ts` | A 或任意（解析逻辑） |
| `src/components/CodeKnowledgeGraph/**` | C + D（子目录分属） |
| `AppImpl.tsx` / `AppWorkspaceLayout.tsx` | E（少改、或抽 hook） |

---

**版本**：1.0（与 Phase 0 骨架同步）
