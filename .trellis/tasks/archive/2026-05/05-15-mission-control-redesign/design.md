# Mission Control 驾驶舱重新设计 —— 技术设计

## 1. 原则

- **Engine 层不动**：`useSplitWizardState` reducer、`services/prdSplit/*`、`services/workflow/*` 保持原样。所有 mutation 仍走 reducer。
- **Presenter 层重写**：`useMissionPresenter` 产出的 ViewModel 结构适配新布局（树形需求 + 泳道任务 + 实时状态）。
- **实时通道**：Rust 端逐行读取 Claude stdout，通过 Tauri `app.emit()` 推送；前端 `listen()` 消费。
- **后台执行**：新增 Rust command 将 claude 进程 spawn 到独立 Tokio task，返回 `run_id` 后立即返回。前端 run store 管理生命周期。
- **错误 Per-cluster**：cluster 错误从全局字段改为 `Map<clusterId, ClusterError>`，失败可独立重试。

## 2. 组件树

```
src/components/MissionControl/
├─ index.ts
├─ MissionControl.tsx                  # 顶层容器；重写
├─ useMissionPresenter.ts             # 重写：适配新 ViewModel
├─ useMissionRunStore.ts              # 新增：后台运行状态管理
├─ copy.ts                            # 微调文案
├─ presenter/
│  ├─ types.ts                        # 扩展：MissionViewModel 增加实时字段
│  ├─ projectMission.ts               # 重写投影函数
│  ├─ projectMission.test.ts
│  ├─ statusModel.ts                  # 保留
│  └─ statusModel.test.ts
├─ header/
│  ├─ MissionHeader.tsx               # 重写：Stepper + 子代理摘要 + CTA
│  ├─ MissionAgentSummary.tsx         # 新增：子代理活动摘要条
│  └─ MissionProgressBar.tsx          # 新增：真实分段进度条
├─ canvas/
│  ├─ MissionCanvas.tsx               # 重写：左树 + 中泳道
│  ├─ RequirementsTree.tsx            # 新增：需求折叠树（替代 RequirementsColumn）
│  ├─ RequirementTreeNode.tsx         # 新增：树节点
│  ├─ TaskSwimlane.tsx                # 新增：泳道图（替代 TaskGraphColumn）
│  ├─ TaskSwimlaneLayer.tsx           # 新增：单个泳道层（替代 ParallelLayerBlock）
│  ├─ TaskCard.tsx                    # 重写：增强卡片（优先级/锚点tag/子代理chip）
│  ├─ DependencyConnector.tsx         # 保留
│  └─ SwimlaneLegend.tsx              # 新增：泳道图例
├─ details/
│  ├─ TaskDetailDrawer.tsx            # 新增：右侧详情抽屉（替代 EvidencePane）
│  ├─ AnchorSection.tsx               # 保留（重构）
│  ├─ TaskEditorInline.tsx            # 保留（重构）
│  └─ EngineeringFoldout.tsx          # 保留
├─ setup/
│  ├─ MissionSetupDrawer.tsx          # 保留（微调文案）
│  └─ MissionTargetPicker.tsx         # 保留
├─ engineering/
│  ├─ EngineeringDrawer.tsx           # 保留
│  └─ ValidationIssueList.tsx         # 保留
├─ actions/
│  ├─ runMissionActions.ts            # 重写：支持重试单个 cluster
│  └─ splitterStreamListener.ts       # 新增：Tauri event 监听
└─ legacy/                            # 保留旧组件引用
```

**删除/替换的旧组件**：
- `canvas/RequirementsColumn.tsx` → 被 `RequirementsTree.tsx` 替代
- `canvas/TaskGraphColumn.tsx` → 被 `TaskSwimlane.tsx` 替代
- `canvas/ParallelLayerBlock.tsx` → 被 `TaskSwimlaneLayer.tsx` 替代
- `details/EvidencePane.tsx` → 被 `TaskDetailDrawer.tsx` 替代
- `canvas/RequirementCard.tsx` → 被 `RequirementTreeNode.tsx` 替代

## 3. 数据模型

### 3.1 扩展 MissionViewModel

```ts
interface MissionViewModel {
  // 保留字段...
  phase: MissionPhase;
  title: string;
  subtitle: string;
  project: { id: string | null; name: string; rootPath: string };
  repositoriesParticipating: Array<{ id: number; name: string; role: string }>;
  phaseStrip: Array<{ key: MissionPhase; label: string; status: "todo" | "current" | "done" }>;
  primaryCta: MissionPrimaryCta;
  risks: { blockedTaskCount: number; validationIssueCount: number };
  
  // 改为树形
  requirementTree: RequirementTreeNodeVM[];
  
  // 改为泳道
  taskSwimlane: SwimlaneVM[];
  
  selection: MissionSelection;
  selectedTaskDetail: TaskDetailVM | null;
  engineering: EngineeringDetailsVM;
  
  // 新增：实时运行状态
  runState: MissionRunState;
}

interface MissionRunState {
  phase: "idle" | "parsing" | "dispatching" | "writing" | "done";
  clusters: Map<string, ClusterRunProgress>;
  startedAt: number | null;
}

interface ClusterRunProgress {
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  progressPercent: number;       // 0-100，真实计算
  stageLabel: string;            // "Claude 启动中…" / "生成任务中…" / "校验中…"
  elapsedMs: number;
  error: ClusterError | null;
}

interface ClusterError {
  summary: string;
  exitCode: number | null;
  stdoutPath: string;
  stderrPath: string;
}

interface RequirementTreeNodeVM {
  id: string;
  label: string;                 // "REQ-01 需求标题"
  taskCount: number;
  completedTaskCount: number;
  priority: "P0" | "P1" | "P2" | null;
  isHighlighted: boolean;
  children?: RequirementTreeNodeVM[];  // 子需求（若有层级）
}

interface SwimlaneVM {
  id: string;
  label: string;                 // "并行组 A · 3 个任务" / "阶段 1"
  isParallel: boolean;
  isBottleneck: boolean;
  tasks: TaskCardVM[];
}

// TaskCardVM 增加字段
interface TaskCardVM {
  // ...保留字段
  priority: "P0" | "P1" | "P2" | null;  // 新增
  prdAnchorTags: string[];               // 新增：PRD 锚点摘要标签
  agentStatus: AgentRunChip | null;      // 新增：子代理状态
}

interface AgentRunChip {
  agentName: string;             // "trellis-splitter" / "trellis-implement" / ...
  status: "queued" | "running" | "done" | "blocked";
  stageLabel: string;            // "research" / "implement" / ...
}
```

### 3.2 实时事件类型

```ts
// Rust → Frontend Tauri events
interface SplitterOutputEvent {
  clusterId: string;
  line: string;
  timestampMs: number;
}

interface SplitterProgressEvent {
  clusterId: string;
  kind: "started" | "stdout-line" | "json-detected" | "completed" | "timeout" | "error";
  message: string;
  progressPercent: number;
}

interface SplitterCompleteEvent {
  clusterId: string;
  status: "succeeded" | "failed" | "timeout";
  runDir: string;
  durationMs: number;
}
```

## 4. Rust 端改造

### 4.1 现有命令改造：`prd_split_dispatch_cluster`

增加 `app: tauri::AppHandle` 参数。将 `stdout.read_to_end()` 改为：

```rust
use tokio::io::{AsyncBufReadExt, BufReader};

let mut stdout = BufReader::new(stdout).lines();
let mut full_output = String::new();
while let Ok(Some(line)) = stdout.next_line().await {
    full_output.push_str(&line);
    full_output.push('\n');
    let _ = app.emit(&format!("splitter:output:{}", cluster_id), 
        json!({ "line": &line, "timestampMs": unix_ms_now() }));
    // 检测 JSON 开始 → emit progress event
    if line.trim_start().starts_with('{') {
        let _ = app.emit(&format!("splitter:progress:{}", cluster_id),
            json!({ "kind": "json-detected", "progressPercent": 80 }));
    }
}
// 后续 extract_json_object / validation 流程不变
```

并发起 `splitter:progress:{clusterId}` 事件：`started` (5%) / `stdout-line` (每行递增) / `json-detected` (80%) / `completed` (100%)。

### 4.2 新增命令：`prd_split_dispatch_cluster_background`

```rust
#[tauri::command]
async fn prd_split_dispatch_cluster_background(
    app: tauri::AppHandle,
    input: DispatchClusterInput,
) -> Result<BackgroundRunToken, String> {
    let run_id = generate_run_id(&input.cluster_id);
    let app_clone = app.clone();
    tokio::spawn(async move {
        // 完整 dispatch 流程（同 prd_split_dispatch_cluster）
        // 但通过 app_clone.emit() 推送进度
        // 完成后写入 run_dir/run-result.json
        // 完成时 emit "splitter:complete:{run_id}"
    });
    Ok(BackgroundRunToken { run_id, run_dir })
}
```

前端可调用此命令后立即返回，通过 Tauri events 监听进度。关闭 Mission Control 后恢复：扫描 `~/.wise/prd-runs/` 中未完成的运行。

### 4.3 模型参数

通过 `--model` CLI 参数传入，沿用现有 `input.model` 字段。Rust 端不做模型锁，由前端（或将来配置）决定。

## 5. 前端实时数据流

```
MissionControl.tsx
├─ useSplitWizardState()  ← 状态管理（不变）
├─ useMissionPresenter()  ← WizardState → ViewModel 投影
├─ useMissionRunStore()   ← 管理后台运行队列
└─ useSplitterStream()    ← listen("splitter:output:*") 更新 runState
```

**`useSplitterStream`**：
```ts
function useSplitterStream(api: UseSplitWizardStateApi) {
  useEffect(() => {
    const unlisten = listen<SplitterOutputEvent>("splitter:output:*", (event) => {
      // 更新 api.patchClusterProgress(clusterId, { progressPercent, stageLabel })
      // 解析关键行驱动进度条
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);
}
```

需要在 `useSplitWizardState` 中新增 `patchClusterProgress` action（仅修改 `clusterRuns[id].progress` 展示字段，不涉及持久化）。

**`useMissionRunStore`**：
```ts
function useMissionRunStore() {
  const [backgroundRuns, setBackgroundRuns] = useState<Map<string, BackgroundRunState>>();
  
  // 挂载时扫描 ~/.wise/prd-runs/ 恢复状态
  useEffect(() => { scanPrdRuns().then(setBackgroundRuns); }, []);
  
  // 监听完成事件
  useEffect(() => {
    listen("splitter:complete:*", (event) => {
      // 更新对应 run 状态
      // 发送系统通知
    });
  }, []);
}
```

## 6. 布局 CSS 方案

```
.mission-control
├─ .mission-header          (h: 72px, flex row)
│  ├─ title block           (flex: 1)
│  ├─ .ant-steps            (flex: 0, 4 steps horizontal)
│  ├─ agent-summary chips   (flex: 0)
│  └─ actions               (flex: 0)
├─ .mission-body            (flex: 1, flex row, overflow: hidden)
│  ├─ .mission-tree-col     (w: 260px, border-right, overflow-y: auto)
│  │  └─ .ant-tree          虚拟滚动
│  ├─ .mission-swimlane-col (flex: 1, overflow-y: auto, padding)
│  │  ├─ .swimlane-layer     (margin-bottom: 16px)
│  │  │  ├─ layer-header     (label + badge)
│  │  │  ├─ task-cards-grid  (grid: repeat(auto-fill, minmax(260px, 1fr)))
│  │  │  └─ dependency-line  (SVG, h: 24px)
│  │  └─ legend-footer       (flex row, border-top)
│  └─ [TaskDetailDrawer]     (Drawer, w: 560px, push mode)
```

响应式断点：
- ≥1280px：完整三区
- 900-1280px：隐藏左列需求树，Header 中放需求下拉选择
- <900px：单列泳道

## 7. 迁移策略

**Step 1**：新建组件，不删旧组件。`MissionControlV2.tsx` 并行开发。
**Step 2**：Rust 端增加 streaming + background 命令，不改现有命令签名（新增参数默认兼容）。
**Step 3**：接入 AppImpl 时用 feature flag 切换 V1/V2。
**Step 4**：验证通过后删除旧 MissionControl 组件目录。

回退：删除 `MissionControlV2` + 恢复 AppImpl 中 feature flag 即可。≤ 5 行改动。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| Rust `BufReader::lines()` 可能因 Claude 输出无换行而阻塞 | 加 read timeout；用 `tokio::select!` 同时等 line 和 timeout |
| 大量 Tauri events 冲击前端渲染 | 前端 throttle（`requestAnimationFrame` 合并更新，最多 30fps） |
| 后台 task 无 AppHandle（窗口关闭后） | 需要保存 `AppHandle` clone；Tauri AppHandle 独立于窗口生命周期，可安全持有 |
| 旧测试断言旧组件结构 | 新组件新建目录 `MissionControlV2/`，旧测试不碰 |
