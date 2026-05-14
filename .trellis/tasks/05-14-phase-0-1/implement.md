# Implement: 代码知识图谱 Phase 0-1

## 执行顺序

### Step 1: 数据库迁移（Rust）

- 在 `src-tauri/src/wise_db.rs` 或独立 migration 中增加三张表：
  - `graph_nodes` — 节点表
  - `graph_edges` — 边表
  - `graph_index_meta` — 索引元数据表
- 验证 migration 在现有 `wise.db` 上可重复运行

### Step 2: Rust DTO 类型 + 命令注册（Rust）

- 新建 `src-tauri/src/code_knowledge_graph.rs` — 命令入口模块
- 新建 `src-tauri/src/code_knowledge_graph/types.rs` — 请求/响应 DTO（带 `Serialize`/`Deserialize`，camelCase）
- 在 `src-tauri/src/lib_impl.rs` 的 `generate_handler!` 中注册三个命令
- Stub 实现：`get_code_graph_subgraph` 返回 fixture 数据（1 repo + 2 folders + 3 files + 3 symbols + 若干 edges）

### Step 3: TypeScript 类型 + Service（Frontend）

- 新建 `src/types/codeKnowledgeGraph.ts` — 与 Rust DTO 对齐的类型与枚举
- 新建 `src/services/codeKnowledgeGraph.ts` — 封装 `invoke` 调用
- 新建 `src/utils/codeKnowledgeGraphResponse.ts` — 响应窄化解析与校验
- 新建 `src/__tests__/codeKnowledgeGraphResponse.test.ts` — 校验逻辑测试

### Step 4: UI 空壳面板（Frontend）

- 新建 `src/components/CodeKnowledgeGraph/CodeKnowledgeGraphPanel.tsx` — Ant Design 面板
- 新建 `src/components/CodeKnowledgeGraph/index.ts` — 导出
- 状态：无数据时显示 Empty + 「重建索引」按钮，加载中显示 Spin
- 入口：在 `AppImpl.tsx` 中增加 `codeKnowledgeGraphMode` 状态（已有则保留）+ 侧栏「图谱」入口

### Step 5: Rust 索引实现

- 新建 `src-tauri/src/code_knowledge_graph/storage.rs` — SQLite CRUD
- 新建 `src-tauri/src/code_knowledge_graph/indexer.rs` — walkdir 文件遍历 + 内容 hash + 增量检测
- 新建 `src-tauri/src/code_knowledge_graph/tree_sitter_parser.rs` — Tree-sitter TS/JS 解析
- 新建 `src-tauri/src/code_knowledge_graph/subgraph.rs` — BFS 子图查询
- 新建 `src-tauri/src/code_knowledge_graph/models.rs` — 内部数据模型
- 替换 `get_code_graph_subgraph` 和 `trigger_code_graph_reindex` 的 stub 为真实实现
- 新增 `get_code_graph_index_status` 实现
- `spawn_blocking` 运行索引任务，避免阻塞主线程

### Step 6: 前端画布（Phase 1）

- 新建 `src/components/CodeKnowledgeGraph/GraphCanvas.tsx` — Canvas 2D 画布
- 支持平移、缩放、节点点击
- 边数超阈值（默认 3000）时提示使用过滤器

### Step 7: Inspector 面板

- 新建 `src/components/CodeKnowledgeGraph/InspectorPanel.tsx` — 节点详情
- 显示节点 ID、kind、label、path、range
- 支持点击画布节点后显示详情

### Step 8: 测试与验证

- `bun test` 通过
- `cargo check` / `cargo clippy` 无警告
- 对实际 TS 仓索引后验证子图查询

## 验证命令

```bash
bun test
bun run tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

## 回滚点

- Step 2 后若 DTO 不稳定：回退到 stub，不改前端
- Step 5 后若索引性能不达标：保留 stub 路径，索引异步化
