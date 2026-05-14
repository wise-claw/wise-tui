# Design: Multi-Repository Knowledge Graph with OpenAPI Bridging

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  CodeKnowledgeGraphPanel (React)                     │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ RepoPicker │  │ IndexStatus│  │ GraphCanvas   │  │
│  │ (multi)    │  │ per repo   │  │ + cross-repo  │  │
│  └─────┬──────┘  └─────┬──────┘  └───────┬───────┘  │
│        │               │                 │           │
│  ┌─────▼───────────────▼─────────────────▼───────┐  │
│  │  useMultiRepoGraph (new hook)                 │  │
│  │  - manage selected repo set                   │  │
│  │  - orchestrate indexing + bridging            │  │
│  │  - fetch multi-subgraph                       │  │
│  └────────────────────┬──────────────────────────┘  │
└───────────────────────┼──────────────────────────────┘
                        │ invoke
┌───────────────────────▼──────────────────────────────┐
│  Tauri Backend (Rust)                                │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │ trigger_code_graph_ │  │ bridge_code_graph_   │  │
│  │ reindex (existing)  │  │ http (existing)      │  │
│  └─────────────────────┘  └──────────────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │ get_code_graph_multi_subgraph (existing)     │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

## Key Finding: Most Backend Commands Already Exist

探索结果显示 Rust 端已有完整的多仓库能力：

| 能力 | 状态 |
|------|------|
| `bridge_code_graph_http(frontendRepoId, backendRepoId)` | 已有 |
| `get_code_graph_multi_subgraph(repoIds, options)` | 已有 |
| `getCodeGraphMultiSubgraph` (前端 service) | 已有 |
| `cross_repo` 边类型 (前端类型) | 已有 |
| 节点 `repo_id` 字段 | 已有 |

**缺口在 UI 层和编排逻辑**：前端面板当前只用单仓库 API，没有多仓库选择、联合索引编排、跨仓库边的可视化。

## Data Flow

### 1. 仓库选择 → 索引编排

```
用户选择 [repoA, repoB]
  → 检查每个仓库的 index status
  → 对未索引的仓库依次 triggerCodeGraphReindex
  → 轮询每个仓库的 status 直到全部 done
  → 调用 bridgeCodeGraphHttp(repoA, repoB)
  → 桥接完成后调用 getCodeGraphMultiSubgraph([repoA, repoB], { includeCrossRepoEdges: true })
```

### 2. 图谱查询

```
getCodeGraphMultiSubgraph({
  repositoryIds: [repoA, repoB],
  hop: 1,
  includeCrossRepoEdges: true,
})
  → 返回合并的 nodes + edges
  → 每个 node 带 repoId 字段
  → 跨仓库边的 kind 为 "cross_repo" 或 "frontend_invokes_api"
```

### 3. 节点展开

```
用户点击节点 X（属于 repoB）
  → getCodeGraphSubgraph({ repositoryId: repoB, focusNodeId: X.id, hop: 1 })
  → 展示 X 的 1 跳邻居（仅限 repoB 内部）
```

## UI Component Changes

### CodeKnowledgeGraphPanel 改造

```
原: repositoryId: number | null
    onSelectRepository?: (repoId: number) => void

新: selectedRepoIds: number[]
    onToggleRepo?: (repoId: number) => void
    repositories: RepositoryInfo[]  (保持不变)
```

- **仓库选择器**：从 `<Select>` 改为 `<Select mode="multiple">` 或 `<Checkbox.Group>`
- **索引控制区**：每个仓库一行，显示状态 + 单独重建按钮
- **「建立联合图谱」按钮**：选中 ≥2 个仓库时出现
- **图谱区域**：使用 `getCodeGraphMultiSubgraph` 获取数据

### GraphCanvas 改造

- 接收合并的 nodes/edges（来自多个仓库）
- 节点颜色：根据 `node.repoId` 映射到不同颜色
- 边样式：`cross_repo` / `frontend_invokes_api` 使用虚线
- 图例（Legend）：显示颜色-仓库映射 + 边类型说明

## New Hook: `useMultiRepoGraph`

从 `CodeKnowledgeGraphPanel` 抽出状态管理逻辑：

```typescript
function useMultiRepoGraph(selectedRepoIds: number[]) {
  // 每个仓库的索引状态
  const [statusMap, setStatusMap] = useState<Map<number, IndexStatus>>();

  // 索引全部选中仓库
  async function indexAll(): Promise<void>;

  // 索引单个仓库
  async function indexOne(repoId: number): Promise<void>;

  // 执行桥接（选中 2 个仓库时）
  async function bridge(): Promise<void>;

  // 查询合并子图
  async function fetchSubgraph(): Promise<MultiSubgraphData>;

  // 清理
  useEffect(() => cleanup, [selectedRepoIds]);
}
```

## Tradeoffs

### 方案选择：串联索引 vs 并行索引

- **串联**（逐个索引）：避免 SQLite 写入竞争，简单可靠
- **并行**（同时索引）：更快但可能锁竞争

**选择串联**，因为当前索引是 CPU 密集型 + SQLite 写入，并行收益有限且增加复杂度。

### 前端仓库数量限制

初始限制最多选择 **5 个仓库**，避免图谱过于复杂。后续可按需放宽。

## Rollback

- 新功能完全在 UI 层和编排逻辑，不修改存储 schema
- 回滚只需恢复 `CodeKnowledgeGraphPanel.tsx`、新增的 hook 和 CSS 文件
- Rust 端已有命令无需改动，不影响其他功能
