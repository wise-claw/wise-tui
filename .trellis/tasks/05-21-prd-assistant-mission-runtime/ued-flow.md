# 需求拆分助手到主会话功能清单

> 用途：交给 UED 设计专家作为原型输入  
> 口径：只列当前代码已有的功能、状态、数据、运行能力和衔接点；不提供主观 UI 设计方案  
> 范围：需求拆分助手、Trellis/Mission runtime、任务落盘、实现 fan-out、主会话任务桥

## 1. 总流程

```text
打开助手
  -> 解析 Trellis 目标
  -> 输入 / 导入 / 保存 PRD
  -> sandbox 解析 PRD
  -> 构建 requirements index
  -> 规划 clusters
  -> 用户显式派发 trellis-splitter
  -> 创建 / 复用 parent task
  -> 并发运行 cluster splitter
  -> strict 校验 splitter JSON
  -> 合并候选任务
  -> 用户复核 / 编辑 / 确认可执行任务
  -> 调整执行波次
  -> 写入 .trellis/tasks
  -> 生成 workflow graph draft
  -> 派发 trellis-implement fan-out
  -> 主会话任务抽屉读取 Trellis tasks
  -> 主会话 / 员工继续执行 Active task
```

## 2. 入口能力

### 2.1 助手宿主入口

已有入口：

- 打开助手 Hub。
- 从助手 Hub 选择 PRD 拆分助手。
- 用事件 `wise:open-task-split-panel` 打开需求拆分助手。
- 用事件 `wise:open-assistant` 打开指定助手或默认助手。
- 从 Workspace 菜单以 `projectId` 打开需求拆分助手。
- 从 Repository 菜单以 `repositoryId` 打开需求拆分助手。
- 从主会话快捷入口打开内置助手。

入口携带参数：

| 参数 | 类型 | 作用 |
|---|---|---|
| `assistantId` | string | 指定助手；PRD 拆分助手为内置助手 |
| `projectId` | string | 以 Workspace 作为需求拆分目标 |
| `repositoryId` | number | 以仓库作为需求拆分目标 |

### 2.2 助手宿主状态

`CockpitSurface` 内部状态：

| 状态 | 含义 |
|---|---|
| `hub` | 展示助手列表 |
| `conversation` | 进入某个助手工作台 |

PRD 拆分助手在 `conversation` 状态下渲染 `PrdTaskSplitPanel`。

### 2.3 返回主会话

能力：

- PRD 助手关闭后返回 Chat 主会话。
- 主会话 session 不因打开助手而销毁。
- Workspace / Repo 主会话都有打开、恢复、创建逻辑。

## 3. Trellis 目标解析能力

### 3.1 统一目标模型

当前统一为 `TrellisTarget`：

```ts
type TrellisTarget = WorkspaceTrellisTarget | StandaloneRepositoryTrellisTarget;
```

共有字段：

| 字段 | 说明 |
|---|---|
| `kind` | `workspace` 或 `standaloneRepository` |
| `displayName` | 展示名称 |
| `rootPath` | Trellis root |
| `repositories` | 可执行仓库列表 |
| `activeRepositoryId` | 当前激活仓库 |
| `defaultExecutionRepositoryId` | 默认执行仓库 |
| `context` | TaskSplitContext |
| `project` | ProjectRef，Standalone Repo 会生成 synthetic project |

Workspace 额外字段：

| 字段 | 说明 |
|---|---|
| `projectId` | Workspace id |
| `projectName` | Workspace 名称 |

Standalone Repo 额外字段：

| 字段 | 说明 |
|---|---|
| `repositoryId` | 仓库 id |
| `repositoryName` | 仓库名称 |

### 3.2 解析输入

```ts
interface ResolveTrellisTargetInput {
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId?: string | null;
  activeRepositoryId?: number | null;
  linkedProjectId?: string | null;
  linkedRepositoryId?: number | null;
}
```

解析优先级：

```text
projectId = linkedProjectId ?? activeProjectId
repositoryId = linkedRepositoryId ?? activeRepositoryId
```

### 3.3 Workspace 规则

- 有 Workspace id 时优先解析 Workspace。
- Workspace 必须存在。
- Workspace 必须有 `rootPath`。
- Workspace 必须关联至少一个可执行仓库。
- Workspace 的 `rootPath` 是 `.trellis` 事实源。
- Workspace 成员仓库只是 execution target。
- 单仓 Workspace 仍保持 Workspace 语义。
- 默认执行仓库优先取 active repo，其次取第一个成员仓库。

### 3.4 Standalone Repo 规则

- 没有 Workspace id 且有 repository id 时解析为 Standalone Repo。
- Standalone Repo 必须存在。
- Standalone Repo 必须有 path。
- Standalone Repo 的 repository path 同时作为 Trellis root 和 execution root。
- Standalone Repo 会生成 `project.id = repo:<repositoryId>`。

### 3.5 解析失败原因

当前返回的失败原因：

- `未找到当前 Workspace。`
- `当前 Workspace 缺少 rootPath，无法作为 Trellis 根目录。`
- `当前 Workspace 尚未关联可执行仓库。`
- `未找到当前游离仓库。`
- `当前游离仓库缺少路径，无法作为 Trellis 根目录。`
- `请先选择 Workspace 或游离仓库。`

## 4. PRD 输入与草稿能力

### 4.1 输入来源

支持：

- 手动输入 Markdown。
- 输入 URL 后抓取正文。
- 导入本地 `.md` / `.markdown` / `.txt` 文件。
- 导入 legacy PRD run。
- 粘贴图片到 PRD。
- 从 PRD 选区新增任务。

### 4.2 URL 输入处理

能力：

- 识别 URL source type。
- 调用 URL fetcher 拉取内容。
- 使用抓取标题补全 PRD title。
- 将 URL 内容归一化为 PRD 文档。
- 若 URL 模式下只有链接文本导致锚点不可定位，会提示锚点风险。
- 拆分后可把归一化 Markdown 回填到编辑器，提升锚点可定位性。

### 4.3 文件导入

能力：

- 打开文件选择器。
- 过滤 Markdown / 文本文件。
- 读取本地文本文件。
- 空文件给 warning。
- 成功后替换当前输入，并重置右侧任务结果。

### 4.4 Legacy run 导入

能力：

- 列出历史 PRD runs。
- 读取某个 run 的 PRD Markdown。
- 空内容给 warning。
- 成功后替换当前输入，并重置右侧任务结果。

### 4.5 图片粘贴

能力：

- 监听 clipboard image。
- 转 base64。
- 优先保存到 `~/.wise`。
- 保存成功后插入图片引用。
- 保存失败时回退为内嵌 base64 图片。

### 4.6 需求草稿管理

支持：

- 创建需求。
- 命名需求。
- 保存需求。
- 删除需求。
- 置顶需求。
- 切换历史需求。
- 自动加载置顶需求；没有置顶时加载最近需求。

每条需求草稿保存：

| 字段 | 说明 |
|---|---|
| `id` | 需求草稿 id |
| `requirementDisplayName` | 需求名称 |
| `isPinned` | 是否置顶 |
| `inputValue` | 当前输入 |
| `originalInputValue` | 原始输入 |
| `contextMode` | project / repository |
| `linkedProjectId` | 关联 Workspace |
| `linkedRepositoryId` | 关联仓库 |
| `createdAt` | 创建时间 |
| `updatedAt` | 更新时间 |

### 4.7 快捷键

| 快捷键 | 能力 |
|---|---|
| `Cmd/Ctrl + S` | 保存需求草稿 |
| `Cmd/Ctrl + Enter` | 执行拆分 |

## 5. 助手资源配置能力

### 5.1 工作流信息

能力：

- 读取 PRD 拆分助手配置。
- 展示助手默认 workflows。
- 无配置时使用内置 `Wise Trellis` 编排。

### 5.2 MCP 资源

能力：

- 读取助手运行态 MCP bundle。
- 读取全局 MCP servers。
- 合并为可选 MCP 列表。
- 支持多选 MCP。
- 保存选择到助手运行态 overrides。

### 5.3 拆分提示词

支持两个 prompt slot：

- `PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1`
- `PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2`

能力：

- 加载仓库层 prompt override。
- 解析存储 JSON。
- 回退到 project / repository 有效 prompt。
- 保存仓库层 prompt override。
- 恢复默认 prompt。
- 使用 Claude 优化 prompt 文本。

prompt 优化边界：

- 不读取本地仓库。
- 不使用额外上下文。
- 只基于当前 prompt 文本改写。

## 6. Sandbox 规划能力

### 6.1 触发

用户点击“拆分”后，先进入 sandbox 规划，不写 `.trellis/tasks`。

### 6.2 处理步骤

系统执行：

1. 解析输入 source。
2. URL source 拉取正文。
3. 归一化为 `PrdDocument`。
4. 去除嵌入的任务锚点标记。
5. 构建 split context。
6. 构建 requirements index。
7. 升级到 requirements index v2。
8. 多仓场景可调用快速 Claude 做需求到仓库分类。
9. 调用 cluster planner 生成 cluster plan。
10. 设置 wizard stage 为 `plan`。
11. 生成 `plannedMissionSummary`。
12. 写入 runtime log，说明仍在 sandbox。

### 6.3 Requirements index v2

包含：

| 字段 | 说明 |
|---|---|
| `schemaVersion` | 当前为 2 |
| `version` | 由 requirements 计算 |
| `requirements` | 需求条目 |
| `requirements[].id` | requirement id |
| `requirements[].content` | 需求内容 |
| `requirements[].bodyHash` | 内容 hash |

### 6.4 Cluster plan

每个 cluster 包含：

| 字段 | 说明 |
|---|---|
| `id` | cluster id |
| `title` | cluster 标题 |
| `primaryRepositoryId` | 主执行仓库 |
| `repositoryIds` | 涉及仓库列表 |
| `requirementIds` | cluster 覆盖的需求 |
| `dependencyClusterIds` | cluster 依赖 |

### 6.5 多仓需求分类

当满足以下条件时会尝试：

- 可选仓库数量大于 1。
- 当前 project 有 rootPath。

能力：

- 将仓库 id/name/type 和 requirement id/content 发给 `run_claude_quick`。
- 要求输出 JSON：requirement id -> repository id。
- 解析失败时静默回退。

### 6.6 Sandbox 阶段不写入

此阶段不会：

- 创建 parent task。
- 写 `.trellis/tasks`。
- 派发 trellis-splitter。
- 写 child tasks。
- 派发 trellis-implement。

## 7. trellis-splitter 派发能力

### 7.1 触发

用户在 cluster preview 阶段点击“派发 splitter”。

### 7.2 Mission 创建

派发前会调用 `createOrResumeMission`：

| 字段 | 来源 |
|---|---|
| `missionId` | `projectId + prdMarkdown` 派生 |
| `projectId` | Trellis target project id |
| `projectName` | Trellis target project name |
| `rootPath` | Trellis root |
| `prdHash` | PRD markdown SHA-256 |
| `title` | PRD title 或 project name |
| `stage` | `dispatch` |
| `status` | `running` |
| `snapshot` | 当前 wizard state |

派发开始事件：

- `mission.dispatch.started`

派发结束事件：

- `mission.dispatch.completed`

### 7.3 Cluster 并发

能力：

- 对所有 clusters 并发执行 `runSingleCluster`。
- 使用 `Promise.allSettled`。
- 单个 cluster 失败不阻止其它 cluster 完成。
- 成功 cluster 最终合并为一个 SplitResult。

### 7.4 Cluster run state

每个 cluster run 记录：

| 字段 | 说明 |
|---|---|
| `clusterId` | cluster id |
| `parentTaskName` | parent task 名称 |
| `parentTaskPath` | parent task 路径 |
| `status` | run 状态 |
| `raw` | Claude raw output 和路径 |
| `normalized` | 归一化 SplitResult |
| `validationIssues` | strict 校验问题 |
| `errors` | 错误列表 |
| `startedAt` | 开始时间 |
| `endedAt` | 结束时间 |
| `progress` | 进度快照 |

状态枚举：

- `idle`
- `skipped-clean`
- `creating-parent`
- `dispatching`
- `succeeded`
- `failed`
- `cancelled`
- `stale`

### 7.5 Assignment 写入

每个 cluster 运行会写 Mission assignment：

| 字段 | 值 |
|---|---|
| `assignmentId` | `missionId + clusterId + splitter` 派生 |
| `agentRunId` | 等于 assignmentId |
| `clusterId` | cluster id |
| `repositoryId` | cluster primary repository |
| `repositoryPath` | cluster 执行仓库路径 |
| `agentType` | `trellis-splitter` |
| `stage` | `split` |
| `status` | running / succeeded / failed / cancelled |
| `metadata` | cluster title、requirement ids 等 |

### 7.6 Trellis runtime 双写

每个 splitter run 同步写 Trellis runtime：

| 表/能力 | 写入内容 |
|---|---|
| `trellis_agent_runs` | agentRunId、projectId、rootPath、taskPath、repositoryId、repositoryPath、agentType、stage、status、metadata |
| `trellis_runtime_events` | `trellis.agent.completed` 或 `trellis.agent.cancelled` |
| heartbeat | 每 30 秒 `trellisAgentHeartbeat(agentRunId)` |

ID 规则：

```text
mission_agent_assignment.assignment_id
  == mission_agent_assignment.agent_run_id
  == trellis_agent_runs.agent_run_id
```

### 7.7 Parent task 创建 / 复用

每个 cluster 在 splitter 前需要 parent task。

新建 parent task：

- 调用 `prd_split_create_parent_task`。
- 写入 PRD Markdown。
- 写入 requirements index JSON。
- 记录 cluster id/title/primaryRepositoryId/repositoryIds。

复用 parent task：

- 如果已有 parent 且允许复用，可复用。
- dirty cluster 复用前会把旧 child tasks 标记回 planning。
- unchanged cluster 可跳过。

### 7.8 splitter bundle

派发给 `trellis-splitter` 的 bundle 包含：

- cluster-filtered PRD。
- `cluster.json`。
- `requirements-index.json`。
- `OUTPUT_SCHEMA.json`。
- 由 `buildSplitRequestPayload` 生成的其它输入文件。

### 7.9 splitter prompt

prompt 第一行：

```text
Active task: <parentTaskPath>
```

关键约束：

- 子代理身份是 `trellis-splitter`。
- 只拆一个 cluster。
- 输出单个 JSON object 到 stdout。
- 不输出 Markdown fence。
- 不调用工具。
- 使用内嵌 bundle。
- 输出必须通过 `validateClaudeSplitPayloadStrict`。
- 每个 task 必须有 `sourceRequirementIds`。
- 每个 task 必须有 `taskAnchors`。
- executable task 的 `missingPrerequisites` 必须为空。
- `clusterId` 必须等于当前 cluster id。
- complex task 必须有 `designMarkdown` 和 `implementMarkdown`。

### 7.10 Raw output

每次 splitter raw output 包含：

| 字段 | 说明 |
|---|---|
| `runId` | 运行 id |
| `runDir` | 运行目录 |
| `exitCode` | 进程退出码 |
| `durationMs` | 耗时 |
| `stdoutPath` | stdout 日志 |
| `stderrPath` | stderr 日志 |
| `rawResultPath` | 原始 JSON 路径 |
| `rawOutput` | 原始 JSON 对象 |
| `stdoutTruncatedPreview` | stdout 预览 |
| `claudeSessionId` | Claude session id |

### 7.11 strict 校验

校验能力：

- 校验 JSON schema。
- 校验 sourceRequirementIds 是否存在。
- 校验 taskAnchors 是否存在。
- 校验 cluster scope，禁止引用非本 cluster requirement id。
- 校验通过后归一化为 SplitResult。

### 7.12 API 错误自动重试

自动重试条件：

- 429。
- rate limit。
- 500 / 502 / 503 / 504。
- overload。
- service unavailable。
- timeout。
- connection error。
- internal server error。

最多重试 3 次。

## 8. splitter 重试与中断能力

### 8.1 用户中断 cluster

输入：

- `runId`
- `clusterId`
- 当前 wizard state
- `missionId`

调用：

- `prd_split_cancel_run`

结果：

- cluster status -> `cancelled`。
- exitCode -> 130。
- 写 Mission assignment completed status `cancelled`。
- 写 Trellis agent run status `cancelled`。
- 写 runtime event `trellis.agent.cancelled`。
- 写 Mission event `mission.cluster.cancelled`。

特殊情况：

- 如果 run 已结束，不覆盖已有结果。
- 如果 run 未注册，标记为 cancelled 以便恢复。

### 8.2 用户重试 cluster

输入：

- `runId`
- `clusterId`
- 当前 wizard state
- `missionId`

调用：

- `prd_split_retry_run`

结果：

- 创建 retry assignment：`missionId + clusterId + splitter-retry`。
- 写 Mission assignment running。
- 写 Trellis agent run running。
- 写 Mission event `mission.cluster.retry_started`。
- 产生 `newRunId` / `newRunDir`。
- 后续通过 `splitter-complete` 事件 hydrate runDir。

### 8.3 retry hydrate

能力：

- 读取 retry `run-result.json`。
- 读取 `split-result.raw.json`。
- 重新执行 strict 校验。
- 重新 normalize。
- patch cluster run。
- complete retry assignment。
- 写 Trellis terminal runtime event。
- 成功时清除 cluster needs resplit。
- 如果有 claudeSessionId，attach Mission 到 session。

### 8.4 splitter-complete 事件

监听事件：

```text
splitter-complete
```

payload：

| 字段 | 说明 |
|---|---|
| `clusterId` | cluster id |
| `status` | succeeded / failed / cancelled |
| `runId` | run id |
| `runDir` | run dir |
| `durationMs` | duration |

处理：

- 校验当前 runId 是否匹配。
- hydrate cluster run。
- 如果输出可用，合并为 SplitResult。
- 保存 split result。
- 写 runtime log。

## 9. 候选任务结果能力

### 9.1 Cluster 结果合并

能力：

- 收集所有 `status=succeeded` 且有 normalized result 的 cluster runs。
- 调用 `mergeClusterSplitResults`。
- 合并为一个 `SplitResult`。
- 保留 PRD source。
- 保留 context。
- 处理 id remap 和 cluster 来源。

### 9.2 SplitResult 保存

能力：

- 保存当前需求 scope 下的 split result。
- 加载时迁移旧格式。
- 如果 PRD 草稿和保存结果不一致，则丢弃 stale result。
- 删除/新增/确认/编辑任务都会立即保存。

### 9.3 SplitResult 主要字段

| 字段 | 说明 |
|---|---|
| `source` | PRD 文档 |
| `context` | TaskSplitContext |
| `splitTasks` | 候选任务列表 |
| `executableTasks` | 旧路径可执行任务列表 |
| `criticalPath` | 关键路径 |
| `parallelGroups` | 执行波次 |
| `unmetPreconditions` | 全局未满足前置 |
| `claudeSplitMapping` | 任务与 requirement 映射 |
| `taskAnchorDescriptors` | 任务锚点描述 |
| `taskAnchorTexts` | 任务锚点文本 |
| `taskAnchorPositions` | 编辑器内锚点位置 |

### 9.4 TaskItem 主要字段

| 字段 | 说明 |
|---|---|
| `id` | 任务 id |
| `title` | 标题 |
| `description` | 描述 |
| `role` | frontend / backend / document |
| `size` | 任务规模 |
| `estimateDays` | 估时 |
| `dependencies` | 依赖 task ids |
| `sourceRefs` | 源文件或代码引用 |
| `sourceRequirementIds` | 来源需求 ids |
| `subtasks` | 子步骤 |
| `dod` | Definition of Done |
| `executionStatus` | executable / not_executable |
| `executionStatusManual` | 是否人工状态 |
| `flowStatus` | todo / in_progress / done / blocked / pending_review / cancelled |
| `taskAnchors` | PRD 锚点 |
| `apiSpec` | 接口协议 |
| `classification` | lightweight / complex |
| `designMarkdown` | 设计文档 |
| `implementMarkdown` | 实施文档 |
| `splitSourceTaskId` | 落盘后对应的源任务 id |

## 10. 任务复核能力

### 10.1 任务过滤

支持：

- 查看未确认任务。
- 查看已确认任务。
- 根据 executionStatus 判断 confirmed / unconfirmed。

### 10.2 单任务编辑

支持编辑：

- description。
- subtasks。
- DoD。
- apiSpec。
- size。

保存能力：

- 检测是否有变化。
- 解析 Markdown draft。
- 合并回 TaskItem。
- 刷新派生字段。
- 保存 split result。

### 10.3 单任务确认

确认时：

- 合并草稿。
- 计算当前任务缺口。
- 计算 split context 缺口。
- 将任务标记为 `executionStatus=executable`。
- 运行 `inferLikelyExecutionDependencies`。
- 保存 split result。

如果仍有缺口：

- 状态仍保存。
- 给 warning。

### 10.4 一键确认

能力：

- 合并所有任务草稿。
- 对每个任务计算缺口。
- 无缺口 -> `executable`。
- 有缺口 -> `not_executable`。
- 推断执行依赖。
- 保存 split result。
- 如果存在可执行任务，切到 confirmed 过滤。

### 10.5 删除任务

能力：

- 禁止删除最后一条任务。
- 删除目标任务。
- 自动移除其它任务对它的依赖。
- 保存 split result。

### 10.6 清空任务

能力：

- 清空 splitTasks。
- 清空 executableTasks。
- 清空 claudeSplitMapping。
- 清空 taskAnchorDescriptors。
- 清空 taskAnchorTexts。
- 清空 taskAnchorPositions。
- 保存 split result。

### 10.7 新增任务

能力：

- 在没有 active result 时，可从当前 PRD fragment 创建 base result。
- 自动生成 `task-N`。
- 根据 repository type 推断 role。
- 默认 size 为 M。
- 默认 executionStatus 为 not_executable。
- 保存 split result。

### 10.8 从 PRD 选区新增任务

能力：

- 读取编辑器选区。
- 生成 anchor descriptor：
  - from。
  - to。
  - mdFrom。
  - mdTo。
  - textHash。
  - contextBefore。
  - contextAfter。
- 尝试映射 sourceRequirementIds。
- 创建新 TaskItem。
- 保存 taskAnchorDescriptors / taskAnchorTexts / taskAnchorPositions。
- 保存 split result。

### 10.9 PRD 锚点能力

支持：

- 根据 taskAnchors range 高亮 PRD。
- 根据 requirement content fallback 定位。
- 根据 taskAnchorTexts 自愈锚点文本。
- 持久化编辑器回传的 anchor ranges。
- 点击 PRD marker 定位右侧任务。
- 任务定位时同步切换 confirmed / unconfirmed filter。

### 10.10 AI 优化任务内容

能力：

- 对单个任务内容调用 Claude。
- 输入包含任务 Markdown 和用户补充提示。
- 不读取本地文件。
- 输出优化后的 Markdown。
- 用户确认后才保存。

### 10.11 AI 可执行检测

能力：

- 对单个任务调用 Claude 评估可执行性。
- 输入包含任务 Markdown、用户提示、仓库上下文摘要。
- 要求输出：
  - 可执行结论。
  - 缺失前置条件。
  - 建议补充。
- 结果保存到任务卡片临时状态，不直接修改任务 executionStatus。

### 10.12 质量统计能力

当前计算：

- totalTasks。
- mappedTaskCount。
- traceableTaskCount。
- untraceableTaskIds。
- mappingRate。
- traceRate。
- fallback mapping count。
- hard validation errors。
- split policy id。
- merge decision。

## 11. 执行编排能力

### 11.1 编排模型

由 `buildExecutionOrchestrationModel` 构建。

输出：

| 字段 | 说明 |
|---|---|
| `requirements` | requirement 与 task 映射 |
| `tasks` | 编排任务列表 |
| `parallelGroups` | 执行波次 |
| `agents` | 按 role/repository 聚合的 agent 项 |
| `conflictWarnings` | 并行冲突 |
| `completedTaskCount` | 已完成任务数 |
| `runningTaskCount` | 运行中任务数 |

### 11.2 任务编排字段

每个编排任务包含：

- id。
- title。
- role。
- sourceRequirementIds。
- dependencies。
- blockedBy。
- repositoryLabel。
- sourceRef。
- sourceRefs。
- touchedFiles。
- requirementLabel。
- requirementTitle。
- dependencyReasons。
- conflictWarnings。
- lane：ready / waiting / blocked。
- agentName。
- statusLabel。

### 11.3 波次生成

能力：

- 优先使用 SplitResult 的 `parallelGroups`。
- 如果没有 parallelGroups，则用 task dependencies 构建。
- 过滤不存在的 task ids。

### 11.4 波次调整

支持：

- 将任务移到上一波次。
- 将任务移到下一波次。
- 将任务移动到指定 wave。
- 保存调整后的 SplitResult。

### 11.5 并行冲突检测

规则：

- 同一 wave 中，如果多个任务的 sourceRefs 指向同一个文件，生成 critical warning。

冲突时：

- 允许用户确认后强行保存编排调整。
- 不强制阻断。

## 12. Trellis 任务落盘能力

### 12.1 触发条件

落盘执行要求：

- 有 activeResult。
- splitTasks 非空。
- 有已确认可执行任务。
- 没有未确认任务。
- 没有正在保存确认状态。

### 12.2 落盘输入

`materializeReviewedTasks(sourceTaskIds)`：

- 可以落盘全部可执行任务。
- 可以只落盘指定 sourceTaskIds。

### 12.3 writeMissionToTrellis

处理流程：

1. 创建 / 恢复 Mission，stage=`writing`。
2. 筛选 succeeded clusters。
3. 对每个 cluster 合并人工编辑。
4. 如果传入 sourceTaskIds，则只选中匹配任务。
5. 调用 `writeClusterTasks` 写 child tasks。
6. 保存 writeResults。
7. 构建 workflow graph inputs。
8. 派发 materialized fan-out。
9. 保存 workflow graph draft。
10. 更新 Mission stage=`done` 或失败回到 `review`。

Mission events：

- `mission.write.started`
- `mission.write.completed`
- `mission.write.failed`

### 12.4 child task 写入

调用 Tauri 命令：

- `prd_split_materialize_tasks`

写入 payload：

| 字段 | 说明 |
|---|---|
| `projectRootPath` | Trellis root |
| `parentTaskName` | parent task |
| `cluster` | cluster ref |
| `childTasks` | child task payload |
| `claudeSplitMapping` | mapping 信息 |

每个 child task payload：

- sourceTaskId。
- title。
- slug。
- prdMarkdown。
- repositoryId。
- clusterId。
- role。
- dependencies。
- sourceRequirementIds。
- taskAnchors。
- classification。
- designMarkdown。
- implementMarkdown。

### 12.5 child prd.md 内容

`renderChildPrd` 写入：

- 标题。
- cluster / repositoryId / role banner。
- Description。
- Source requirements。
- Subtasks。
- DoD。
- Dependencies。
- Anchor。
- not_executable 标记。

### 12.6 Write result

每个 cluster 的 write result：

| 字段 | 说明 |
|---|---|
| `clusterId` | cluster id |
| `parentTaskName` | parent task |
| `childTaskNames` | child task 名称 |
| `childTasks` | sourceTaskId/taskName/taskPath |
| `warnings` | 写入 warning |
| `error` | 写入错误 |

### 12.7 落盘结果汇总

`RequirementMissionMaterializeResult`：

| 字段 | 说明 |
|---|---|
| `parentTaskNames` | 成功 parent task names |
| `childTaskNames` | 成功 child task names |
| `childTasks` | sourceTaskId/taskName/taskPath |
| `failedCount` | 失败数量 |

## 13. Workflow graph 能力

落盘后会生成 workflow artifacts。

输入：

- projectId。
- projectName。
- projectRootPath。
- requirementsIndex。
- clusters。
- parentTaskName。
- childTasks。
- tasks。

输出并保存：

- workflow template。
- workflow graph。
- graph status=`draft`。
- node count。
- edge count。

如果 context mode 为 project：

- 调用 `addProjectPrdWorkflow` 关联项目。

保存成功后广播：

- `wise:workflow-graph-changed`

保存失败：

- 不回滚 Trellis 任务。
- `workflowGraphResult.error` 记录错误。

## 14. 实现 fan-out 能力

### 14.1 触发

child tasks 写入成功后，调用：

- `dispatchWorkspaceTrellisMaterializedFanout`

### 14.2 执行仓库选择

根据 cluster 选择 repository target：

- 优先 cluster.primaryRepositoryId。
- 其次 cluster.repositoryIds[0]。
- 再 fallback 到 repositories[0]。

输出：

- repositoryPath。
- ownerRepositoryId。
- ownerRepositoryName。
- ownerRepositoryPath。
- repositoryType。

如果 repositoryPath 为空：

- fan-out 失败。

### 14.3 fan-out 输入

| 字段 | 说明 |
|---|---|
| `sessionId` | `prd-split:<parentTaskName>` |
| `projectId` | project id |
| `projectRootPath` | Trellis root |
| `repositoryPath` | 执行仓库 |
| `sourceTasks` | 待执行源任务 |
| `materializedResult` | child task 写入结果 |
| `parallelGroups` | 执行波次 |
| `subagentType` | 默认 `trellis-implement` |
| `repositoryMetadata` | 仓库元信息 |

### 14.4 fan-out 波次

能力：

- 把 source task id 映射到 materialized Trellis task path。
- 将 dependencies remap 为 child task active path。
- 根据 parallelGroups 构建 wave。
- 未包含在 parallelGroups 的任务追加到最后一波。

### 14.5 fan-out runtime snapshot

字段：

| 字段 | 说明 |
|---|---|
| `status` | idle / running / succeeded / failed |
| `workflowRunId` | workflow run id |
| `totalCount` | 总任务 |
| `doneCount` | 成功数 |
| `failedCount` | 失败数 |
| `waves` | wave snapshots |
| `message` | 当前消息 |

每个 wave：

- waveIndex。
- status。
- tasks。

每个 task：

- sourceTaskId。
- workflowTaskId。
- title。
- status。
- taskName。
- taskPath。
- activeTaskPath。
- message。

### 14.6 执行动作

每波调用：

- `runSplitTasksOmcBatch`

参数：

- templateId=`trellis`。
- subagentType=`trellis-implement`。
- concurrency=当前 wave 任务数。
- executionMetadata：
  - ownerKind=`repository`。
  - stage=`implement`。
  - subagentType。
  - parentTaskName。
  - waveIndex。
  - repository metadata。
- executionMetadataByTaskId：
  - activeTaskPath。
  - sourceTaskId。
  - childTaskName。

### 14.7 TrellisWorkflowAdapter

实现任务时：

- 准备 git worktree。
- 执行 Claude Code oneshot。
- prompt 第一行为 `Active task: <activeTaskPath>`。
- `trellis-implement` prompt 要求：
  - 读取 prd.md。
  - 按 spec 实现。
  - 跑 focused tests。
  - 不 commit。
  - 不 stage。

支持 stage hint：

- `trellis-implement`
- `trellis-check`
- `trellis-continue`

### 14.8 运行事件

fan-out 会广播：

- `wise:split-todo-count-updated`
- `wise:omc-batch-runtime-changed`

`split-todo-count-updated` detail：

- source=`trellis`。
- projectId。
- parentTaskName。
- childTaskNames。
- focusParentTaskName。
- focusChildTaskNames。
- openTaskDrawer。

## 15. 主会话衔接能力

### 15.1 Workspace 主会话

打开 Workspace 主会话时：

1. 解析 Workspace session anchor。
2. rootPath 缺失时提示。
3. 进入 chat view。
4. 设置 active project。
5. 设置 active repository。
6. 查找已绑定 main session。
7. 若有则 switch。
8. 若无，找同路径最近 session。
9. 若仍无，创建 session。
10. 绑定 project main session key。

### 15.2 Repo 主会话

打开 Repo 主会话时：

1. 进入 chat view。
2. 设置 active repository。
3. 使用 repository path 作为 session cwd。
4. 查找已绑定 main session。
5. 若有则 switch。
6. 若无，找同路径最近 session。
7. 若仍无，创建 session。
8. 绑定 repository path。

### 15.3 主会话自动绑定 Mission

当 active session + active project + rootPath 存在：

- 查找最近 active Mission。
- 如果 session 未绑定当前 active Mission，则 attach。

Active Mission 判定：

- stage 不在 `done` / `archived`。

attach metadata：

- source=`main_chat`。
- rootPath。

### 15.4 主会话消息记录 Mission

主会话 composer 发送消息时：

- 调用 `recordMissionComposerMessage`。
- 先 ensure session bound to active mission。
- 提取 `@mention`。
- 写 Mission agent commands。
- 写 Mission event `mission.session.message`。

mention 记录字段：

- commandType=`mention`。
- targetKind=`text`。
- targetId=mention。
- result.sessionId。
- result.source=`main_chat`。

## 16. 主会话任务抽屉能力

### 16.1 任务来源

主会话任务抽屉有两类：

| 来源 | 说明 |
|---|---|
| Wise split executableTasks | 旧 split result 兼容路径 |
| Workspace Trellis tasks | `.trellis/tasks` 扫描结果 |

### 16.2 Trellis task 扫描

Workspace Trellis tasks 来自：

- `listProjectRequirementWorkspace`
- Tauri command `trellis_list_requirement_workspace`

输入：

- projectRootPath。
- projectRepositoryPaths。
- floatingRepositoryPaths。
- includeArchived=true。

返回：

- sources。
- prds。
- tasks。

### 16.3 TrellisRequirementTaskRow 字段

| 字段 | 说明 |
|---|---|
| `taskId` | task id |
| `dir` | task 目录 |
| `title` | 标题 |
| `status` | 状态 |
| `hasPrd` | 是否有 prd |
| `hasResearch` | 是否有 research |
| `createdAt` | 创建时间 |
| `parent` | 父任务 |
| `archived` | 是否归档 |
| `rootPath` | Trellis root |
| `sourceKind` | project / projectRepository / floatingRepository |
| `repositoryId` | 仓库 id |
| `clusterId` | cluster id |
| `sourceRequirementIds` | 来源需求 ids |

### 16.4 Runnable 过滤

Trellis task 可运行条件：

- 未 archived。
- 有 parent。
- status 不是 completed。
- status 不是 rejected。
- status 不是 archived。

### 16.5 任务抽屉刷新

监听事件：

- `wise:split-todo-count-updated`

触发后：

- 重新加载 Wise split tasks。
- 重新扫描 Workspace Trellis tasks。
- 如果 detail source 是 `trellis` 且 `openTaskDrawer=true`，会打开任务抽屉并设置 focus。

### 16.6 focus 能力

focus 字段：

- parentTaskName。
- childTaskNames。

过滤逻辑：

- 如果 childTaskNames 命中 taskId，则展示。
- 如果 parentTaskName 命中 task.parent，则展示。
- 如果没有命中，展示全部 runnable tasks。

### 16.7 主会话执行 Trellis task

点击主会话执行时：

- 调用 `onExecute(session.id, buildTrellisTaskExecutionPrompt(task))`。

prompt：

```text
Active task: <relative task path>

请基于该 Workspace Trellis 任务继续执行。

任务ID：<taskId>
标题：<title>
状态：<status>
父任务：<parent>
分片：<clusterId>
关联需求：<sourceRequirementIds>

请先读取任务目录中的 task.json / prd.md / design.md / implement.md（如存在），再按项目 AGENTS.md 与 .trellis/spec 继续实现、验证并更新任务状态。
```

relative task path 计算：

- 如果 task dir 在 rootPath 下，转成相对路径。
- 如果包含 `/.trellis/tasks/`，截取 `.trellis/tasks/...`。
- 否则使用 task.dir 或 fallback `.trellis/tasks/<taskId>`。

### 16.8 员工执行 Trellis task

支持：

- 单任务选择员工后执行。
- 批量选择 Trellis tasks 后选择员工执行。

执行方式：

- 同样发送 `buildTrellisTaskExecutionPrompt(task)`。
- 额外传 `targetType=employee`。
- 传 `targetEmployeeName`。

### 16.9 Trellis task 归档

支持：

- 单任务删除。
- 批量删除。

实际调用：

- `trellis_archive_task`

语义：

- 移入 `.trellis/tasks/archive/YYYY-MM/`。
- 子目录一并移动。
- 从当前列表移除。
- 广播 `wise:split-todo-count-updated` 刷新。

## 17. Wise 旧可执行任务兼容能力

主会话任务抽屉仍支持旧 split result 的 executableTasks。

能力：

- 读取 `loadPrdTaskSplitResult`。
- 只展示 flowStatus 为 todo / done 的 executable tasks。
- 状态筛选：all / todo / done。
- 单任务主会话执行。
- 单任务员工执行。
- 单任务团队执行。
- 批量 OMC 执行。
- 完成任务。
- 删除任务。
- 全部删除。

旧任务 prompt 与 Trellis task prompt 不同，不是当前 Trellis-native 主链路。

## 18. 错误与失败能力总表

### 18.1 目标与输入

| 场景 | 系统行为 |
|---|---|
| 无目标 | 阻断 splitter 派发 |
| Workspace 缺 rootPath | 返回 target resolution error |
| Workspace 无仓库 | 返回 target resolution error |
| Repo 缺 path | 返回 target resolution error |
| PRD 为空 | parse plan 返回失败 |
| 无 requirement | parse plan 返回失败 |
| 导入空文件 | warning |
| Legacy PRD 空 | warning |
| 图片保存失败 | fallback base64 |

### 18.2 splitter

| 场景 | 系统行为 |
|---|---|
| 创建 parent 失败 | cluster failed，写 Mission/Trellis failure |
| Claude command invoke 失败 | DispatchClusterResult errors |
| Claude exitCode 非 0 | errors 增加退出码 |
| rawOutput 缺失 | 返回 runDir/stdout/raw 路径提示 |
| strict validation 失败 | normalized=null，记录 issues |
| cluster scope 失败 | normalized=null，记录 issues |
| API 可重试错误 | 自动 retry |
| 用户 cancel | status=cancelled |
| retry run-result 解析失败 | hydrate failed |

### 18.3 复核与落盘

| 场景 | 系统行为 |
|---|---|
| 删除最后一条任务 | 阻止 |
| 保存 split result 失败 | toast error |
| 没有可落盘任务 | writeMissionToTrellis 抛错 |
| 缺少 normalized 或 parentTaskName | 写入 result error |
| child task 缺少 materialized path | fan-out failed |
| execution repository path 为空 | fan-out rejected |
| workflow graph 保存失败 | warning，不阻断落盘 |
| fan-out 某波失败 | 停止后续波，status failed |

### 18.4 主会话

| 场景 | 系统行为 |
|---|---|
| Workspace rootPath 缺失 | 不打开项目主会话 |
| task archived/completed/rejected | 不进入 runnable 列表 |
| 员工为空 | 员工执行提示先选择员工 |
| 归档失败 | 返回错误 toast |

## 19. 状态枚举汇总

### 19.1 PRD 助手阶段条

- `intake`：收集。
- `plan`：规划。
- `review`：审查。
- `dispatch`：派发。
- `done`：落盘。

每项状态：

- `waiting`
- `active`
- `done`

### 19.2 Wizard stage

- `input`
- `plan`
- `dispatch`
- `review`
- `writing`
- `done`

### 19.3 Cluster run status

- `idle`
- `skipped-clean`
- `creating-parent`
- `dispatching`
- `succeeded`
- `failed`
- `cancelled`
- `stale`

### 19.4 Cluster progress status

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `skipped`

### 19.5 Runtime log status

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `info`

### 19.6 Fan-out status

整体：

- `idle`
- `running`
- `succeeded`
- `failed`

Wave / task：

- `waiting`
- `running`
- `succeeded`
- `failed`

### 19.7 Task flow status

- `todo`
- `in_progress`
- `done`
- `blocked`
- `pending_review`
- `cancelled`

## 20. 本清单依据文件

入口与助手宿主：

- `src/components/CockpitSurface/index.tsx`
- `src/components/CockpitSurface/AssistantHub.tsx`
- `src/components/CockpitSurface/AssistantConversationView.tsx`
- `src/AppImpl.tsx`
- `src/constants/workflowUiEvents.ts`

目标与状态机：

- `src/components/PrdSplitWizard/targetModel.ts`
- `src/components/PrdSplitWizard/useSplitWizardState.ts`
- `src/components/PrdSplitWizard/types.ts`
- `src/components/PrdTaskSplitPanel/useRequirementMissionController.ts`

PRD 助手：

- `src/components/PrdTaskSplitPanel/PrdTaskSplitPanelImpl.tsx`
- `src/components/PrdTaskSplitPanel/usePrdTaskSplitPanelController.tsx`
- `src/components/PrdTaskSplitPanel/RequirementInputCard.tsx`
- `src/components/PrdTaskSplitPanel/RequirementBoardActions.tsx`
- `src/components/PrdTaskSplitPanel/TaskResultPanel.tsx`
- `src/components/PrdTaskSplitPanel/SplitRuntimeMessages.tsx`
- `src/components/PrdTaskSplitPanel/ExecutionOrchestrationPanel.tsx`
- `src/components/PrdTaskSplitPanel/ExecutionRuntimeQueue.tsx`

运行、派发、落盘：

- `src/components/MissionControl/actions/runMissionActions.ts`
- `src/services/prdSplit/splitterDispatch.ts`
- `src/services/prdSplit/trellisWriter.ts`
- `src/services/prdSplit/materializedFanoutBridge.ts`
- `src/services/prdSplit/executionFanout.ts`
- `src/services/workflow/trellisAdapter.ts`

主会话：

- `src/components/ClaudeSessions/ClaudeChat.tsx`
- `src/components/ClaudeChatInput/missionMentionHook.ts`
- `src/services/mission/sessionBinding.ts`
- `src/services/trellisTaskBridge.ts`

产品任务背景：

- `.trellis/tasks/05-21-prd-assistant-mission-runtime/prd.md`
- `.trellis/tasks/05-21-prd-assistant-mission-runtime/design.md`
- `.trellis/tasks/05-21-prd-assistant-mission-runtime/implement.md`
- `.trellis/spec/guides/agent-harness-architecture.md`
