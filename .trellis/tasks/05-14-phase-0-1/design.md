# Design: 代码知识图谱 Phase 0-1

## 1. 架构概览

```
Wise 前端 (React + Ant Design)
  └── CodeKnowledgeGraphPanel.tsx          # 面板壳
  └── GraphCanvas.tsx                       # Canvas 画布
  └── InspectorPanel.tsx                    # 节点详情
  └── services/codeKnowledgeGraph.ts        # Service 门面
  └── types/codeKnowledgeGraph.ts           # DTO
  └── utils/codeKnowledgeGraphResponse.ts   # 响应校验

Wise Tauri Backend (Rust)
  └── code_knowledge_graph.rs               # 命令入口
  └── code_knowledge_graph/
      ├── indexer.rs                        # 文件遍历 + Tree-sitter 解析
      ├── storage.rs                        # SQLite 节点/边读写
      ├── subgraph.rs                       # 子图 hop 查询
      ├── types.rs                          # 请求/响应 DTO（Serialize/Deserialize）
      ├── tree_sitter_parser.rs             # TS/JS 解析封装
      └── models.rs                         # 内部数据模型
```

## 2. 数据契约

### 2.1 节点类型枚举

| 类型 | 说明 |
|------|------|
| `repo` | 仓库根 |
| `folder` | 目录 |
| `file` | 文件 |
| `symbol` | 类/函数/方法/接口（带 `symbolKind` 子类型） |

首版不实现 `import`（折叠为边）、`api_operation`、`schema`。

### 2.2 边类型枚举

| 类型 | 说明 |
|------|------|
| `contains` | 目录→文件 / 文件→符号 |
| `imports` | 文件/符号间依赖 |
| `calls` | 调用关系 |
| `implements` | 实现关系 |

首版不实现 `frontend_invokes_api`、`backend_serves_api`、`cross_repo`。

### 2.3 节点 ID 格式

`{repoId}:{kind}:{stableKey}` — stableKey 为规范化路径 + 符号 qualified name 的 SHA-256 前 16 位 hex。

### 2.4 IPC 请求/响应

**`get_code_graph_subgraph`**
```typescript
interface CodeGraphSubgraphRequest {
  repositoryId: number;
  focusNodeId?: string;
  hop?: 1 | 2 | 3;
  nodeTypeFilter?: string[];
}

interface CodeGraphSubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    truncated: boolean;
    totalEdgeHint?: number;
    indexVersion: string;
    errors?: ParseError[];
  };
}

interface GraphNode {
  id: string;
  kind: 'repo' | 'folder' | 'file' | 'symbol';
  symbolKind?: string;
  label: string;
  path: string;
  repoId: number;
  range?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'contains' | 'imports' | 'calls' | 'implements';
  props?: Record<string, unknown>;
}
```

**`trigger_code_graph_reindex`**
```typescript
interface CodeGraphReindexRequest {
  repositoryId: number;
}
```

**`get_code_graph_index_status`**
```typescript
interface CodeGraphIndexStatusResponse {
  status: 'idle' | 'indexing' | 'done' | 'error';
  progress?: number;  // 0-100
  repositoryId: number;
  indexVersion?: string;
  error?: string;
}
```

## 3. 存储设计

### 3.1 SQLite 表

**`graph_nodes`**
```sql
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('repo','folder','file','symbol')),
  symbol_kind TEXT,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  range_start_line INTEGER,
  range_start_col INTEGER,
  range_end_line INTEGER,
  range_end_col INTEGER,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`graph_edges`**
```sql
CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  kind TEXT NOT NULL CHECK(kind IN ('contains','imports','calls','implements')),
  props TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_edges_source ON graph_edges(source_id);
CREATE INDEX idx_edges_target ON graph_edges(target_id);
```

**`graph_index_meta`**
```sql
CREATE TABLE graph_index_meta (
  repo_id INTEGER PRIMARY KEY,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  total_nodes INTEGER DEFAULT 0,
  total_edges INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 4. 索引实现策略

### 4.1 文件遍历

- 使用 `walkdir` crate 递归扫描已登记 Repository 路径
- 排除 `.git`、`node_modules`、`dist`、`build`、`.trellis`、`.claude`
- 仅扫描 `.ts`、`.tsx`、`.js`、`.jsx` 文件（Phase 0-1 范围）
- 每个文件计算 SHA-256 前 16 位作为 content hash，与 DB 中已有 hash 对比决定是否重解析

### 4.2 Tree-sitter 解析

- 使用 `tree-sitter` + `tree-sitter-typescript` crate
- 对每个文件生成语法树，遍历提取：
  - 函数/方法声明 → `symbol` 节点 (symbolKind: `function`)
  - 类声明 → `symbol` 节点 (symbolKind: `class`)
  - 接口声明 → `symbol` 节点 (symbolKind: `interface`)
  - import 语句 → `imports` 边
- 生成 `file → symbol` 的 `contains` 边

### 4.3 子图查询

- BFS 从 `focusNodeId` 出发，按 hop 参数扩展邻接节点
- 应用 `nodeTypeFilter` 过滤返回节点
- 结果集超过阈值（默认 5000 节点）时截断并设 `truncated: true`

## 5. 前端实现策略

### 5.1 布局

```
<Panel>
  <Header> 图谱标题 + 仓库选择器 + 索引状态 + 重建按钮 </Header>
  <Content>
    <GraphCanvas />     ← 左侧: Canvas 画布 (60%)
    <InspectorPanel />  ← 右侧: 节点详情 (40%)
  </Content>
</Panel>
```

### 5.2 画布（Phase 0-1）

- 首版使用 Canvas 2D（非 WebGL），满足 < 3000 边的场景
- 使用 `react-force-graph-2d` 或自研 Canvas 绘制
- 支持平移、缩放、节点点击
- 边数超阈值时提示「使用过滤器减少显示」

### 5.3 状态管理

- 面板内 React `useState` + `useCallback` 管理
- 不复用全局 store（避免 AppImpl 膨胀）

## 6. 依赖

- `tree-sitter` / `tree-sitter-typescript` — Rust 侧代码解析
- `walkdir` — 文件遍历
- `sha2` — 内容 hash
- 前端 Canvas 绘图库（待定，优先 `react-force-graph-2d` 或原生 Canvas API）

## 7. 风险

| 风险 | 缓解 |
|------|------|
| Tree-sitter WASM 编译 | 使用 Rust crate 而非 WASM，cargo 编译期集成 |
| 大仓库索引耗时 | spawn_blocking + 进度状态 + 可取消 |
| Canvas 2D 性能瓶颈 | Phase 2 替换为 WebGL，首版设定 3000 边阈值 |
