# 需求拆分助手交互重构设计

> 目标：让用户一眼看懂“我现在在哪一步、系统写没写文件、下一步该点什么、出了问题去哪看”。
> 风格：Dense developer tool + Enterprise console + Tech utility。
> 范围：只设计需求拆分助手交互，不重写 Wise 整体视觉系统。

## 1. 当前问题诊断

现在的交互难懂，核心不是控件少，而是状态被藏起来了。

主要问题：

- “拆分”这个按钮实际先做 sandbox 规划，但用户会以为已经开始生成任务。
- “派发 splitter”“落盘执行”“执行 fan-out”这些动作分属不同阶段，但视觉上像同一个流程里的普通按钮。
- 左侧 PRD、右侧任务、运行日志、编排确认、落盘队列都在同一块区域切换，用户不知道右侧当前代表什么状态。
- 顶部目标条有 root/repo/stage，但没有明确说明“当前是否已经写入 `.trellis/tasks`”。
- 运行过程和结果列表互相抢位置，完成后“重看过程”不够像一个可追踪 runtime。
- 候选任务复核和编排落盘的边界不够明显，用户不知道为什么按钮灰了。
- 主会话衔接太隐性，落盘后用户不知道下一步应该回到哪里继续执行。

需要解决的关键认知：

```text
需求助手不是一个“生成任务按钮”
而是一条可控流水线：
PRD -> 分片预览 -> 子代理拆分 -> 任务复核 -> 执行编排 -> 写入 Trellis -> 主会话继续
```

## 2. 新交互骨架

整体改成“三层固定认知 + 一个工作区”。

```text
┌──────────────────────────────────────────────────────────────┐
│ A. Mission Header：目标 / 写入边界 / 下一步主按钮               │
├──────────────────────────────────────────────────────────────┤
│ B. Stage Rail：1 输入 2 分片 3 运行 4 复核 5 编排 6 执行          │
├───────────────┬──────────────────────────────────────────────┤
│ C. PRD Source │ D. Workbench                                 │
│ 固定来源区     │ 根据阶段切换：分片表 / 运行表 / 任务表 / 波次 / 队列 │
└───────────────┴──────────────────────────────────────────────┘
```

### A. Mission Header

始终固定在顶部，解决“我在哪个目标上操作”和“下一步是什么”。

包含：

- 当前目标：`Workspace: Wise` 或 `Standalone Repo: web`
- Trellis Root：实际 `.trellis` 写入根目录
- 执行仓库：当前默认 execution repo
- 写入边界：
  - `沙箱预览：不会写入 .trellis/tasks`
  - `运行中：正在创建/复用 parent task`
  - `已写入：child tasks 已落到 .trellis/tasks`
- 主 CTA：随阶段变化
- 次 CTA：运行日志、返回主会话、设置

主 CTA 规则：

| 当前状态 | 主 CTA |
|---|---|
| 无 PRD | `导入或粘贴 PRD`，disabled |
| 有 PRD，未规划 | `生成分片预览` |
| 已规划 cluster | `运行拆分子代理` |
| splitter 运行中 | `查看运行详情` |
| 有候选任务，未全确认 | `确认可执行任务` |
| 全部确认 | `写入 Trellis 并派发实现` |
| 已写入 | `打开主会话任务` |
| 目标不可用 | `配置目标` |

按钮命名替换：

| 旧文案 | 新文案 |
|---|---|
| 拆分 | 生成分片预览 |
| 派发 splitter | 运行拆分子代理 |
| 重看过程 | 运行日志 |
| 落盘执行 | 写入 Trellis 并派发实现 |
| 执行 fan-out | 实现派发队列 |
| 可执行任务 | 已确认任务 |

### B. Stage Rail

顶部第二行固定展示 6 个阶段。

| 阶段 | 名称 | 含义 |
|---|---|---|
| 1 | PRD 输入 | 收集需求文本、导入文件、选择助手资源 |
| 2 | 分片预览 | 生成 requirements index 和 cluster plan，不写文件 |
| 3 | 子代理拆分 | 创建/复用 parent task，运行 trellis-splitter |
| 4 | 任务复核 | 合并候选任务，编辑、补充、确认可执行 |
| 5 | 执行编排 | 调整波次、依赖、并行冲突 |
| 6 | Trellis 执行 | 写入 child tasks，派发 trellis-implement，回主会话 |

每个阶段状态：

- 等待：灰色
- 当前：蓝色 / 高亮
- 完成：绿色
- 阻断：橙色
- 失败：红色

阶段下方显示一个短状态句：

- `已识别 18 条需求，规划 4 个 cluster`
- `C2 失败，C1/C3/C4 已完成`
- `12 个候选任务，8 个未确认`
- `3 个波次，1 个并行冲突`
- `已写入 12 个 child tasks`

## 3. 主工作区布局

### 3.1 PRD Source 区

左侧只负责来源，不承载流程状态。

默认宽度：

- 输入阶段：45%
- 进入复核/编排后：收缩为 320px 来源栏

模块顺序：

1. 需求历史
   - 当前需求名
   - 新建
   - 保存
   - 置顶
   - 删除
   - 历史切换

2. PRD 编辑器
   - 文本/Markdown
   - 图片粘贴
   - task anchor marker
   - 选区生成任务

3. 来源操作
   - 导入 PRD
   - 历史导入
   - 保存草稿

4. 助手资源
   - 编排：Wise Trellis / configured workflows
   - MCP 多选
   - 拆分提示词

压缩态只保留：

- 当前需求名
- requirement 数
- PRD 目录/锚点摘要
- 展开编辑按钮

这样任务复核和编排阶段不会被半屏编辑器挤压。

### 3.2 Workbench 区

右侧按照阶段切换，不再让多个状态混在同一卡片。

Workbench 有 5 个视图：

| 视图 | 出现条件 |
|---|---|
| 分片预览 | 已生成 plannedMissionSummary，未 dispatch |
| 运行详情 | splitter 运行中，或用户打开运行日志 |
| 候选任务 | 有 activeResult，未进入编排 |
| 执行编排 | 用户进入编排确认 |
| 实现队列 | materializedExecutionResult 存在 |

顶部有视图切换，但按流程自动进入最相关视图：

```text
分片预览 -> 运行详情 -> 候选任务 -> 执行编排 -> 实现队列
```

## 4. 分片预览视图

用途：告诉用户系统理解了 PRD，并准备把需求分给哪些 splitter。

核心信息：

- requirements 总数
- cluster 总数
- 涉及仓库数
- 当前仍是 sandbox
- 不会写 `.trellis/tasks`

列表字段：

| 字段 | 内容 |
|---|---|
| Cluster | C1 / C2 / C3 |
| 标题 | cluster title |
| 需求 | requirement ids + 数量 |
| 执行仓库 | primary repo |
| 依赖 | dependency cluster ids |
| 状态 | 等待运行 |

动作：

- `运行全部拆分子代理`
- `返回修改 PRD`
- `查看 requirements index`

空态：

- 无 PRD：提示先输入 PRD
- 无 requirement：提示 PRD 需要功能/非功能/验收条目
- 目标不可用：提示配置 Workspace / Repo

## 5. 运行详情视图

用途：让用户理解 splitter 正在做什么，失败后能重试/中断。

结构：

```text
┌────────────────────────────────────────────┐
│ 运行总览：4 clusters · 2 running · 1 failed │
├────────────────────────────────────────────┤
│ Cluster run table                           │
├────────────────────────────────────────────┤
│ 选中 cluster 的日志与产物路径                │
└────────────────────────────────────────────┘
```

Cluster run table 字段：

| 字段 | 内容 |
|---|---|
| Cluster | C1 / title |
| Repo | execution repo |
| Status | queued / creating parent / dispatching / succeeded / failed / cancelled |
| Parent | parentTaskPath |
| Tasks | 输出任务数 |
| Duration | 耗时 |
| Actions | 中断 / 重试 / 查看 |

详情区字段：

- runId
- runDir
- stdoutPath
- stderrPath
- rawResultPath
- claudeSessionId
- validationIssues
- errors

状态动作：

| 状态 | 动作 |
|---|---|
| dispatching | 中断 |
| failed | 重试 |
| cancelled | 重试 |
| succeeded | 查看输出 |

## 6. 候选任务视图

用途：把 splitter 输出变成用户可复核的任务清单。

顶部摘要：

- 总任务数
- 未确认数
- 已确认数
- 映射率
- 锚点可追踪率
- 不可执行任务数

过滤：

- 未确认
- 已确认
- 全部
- 有缺口
- 无锚点

任务列表建议用“密集表 + 右侧详情”替代全卡片堆叠：

左侧表格字段：

| 字段 | 内容 |
|---|---|
| ID | task id |
| 标题 | title |
| 角色 | frontend/backend/document |
| 状态 | 未确认/可执行/不可执行 |
| 来源需求 | sourceRequirementIds |
| 依赖 | dependencies |
| 锚点 | 有/无/失效 |
| 缺口 | missingPrerequisites count |

右侧详情：

- description
- subtasks
- DoD
- apiSpec
- sourceRefs
- taskAnchors
- designMarkdown
- implementMarkdown
- AI 优化
- 可执行检测

主动作：

- `确认当前任务`
- `一键确认可执行任务`
- `新增任务`
- `从 PRD 选区新增任务`
- `保存修改`
- `删除任务`

阻断规则显性展示：

- 未确认任务 > 0 时，不能写入 Trellis。
- 不可执行任务存在时，显示缺口原因。
- 锚点缺失不阻断，但要显示风险。

## 7. 执行编排视图

用途：在写入 Trellis 前确认并行/串行关系。

结构：

```text
┌───────────────┬──────────────────────┬────────────────┐
│ 需求覆盖       │ 波次编排              │ 冲突与派发摘要   │
└───────────────┴──────────────────────┴────────────────┘
```

需求覆盖：

- requirement id
- requirement 摘要
- 关联 task 数
- 未覆盖 warning

波次编排：

- Wave 1：并行任务
- Wave 2：依赖 Wave 1
- Wave 3：后置任务
- 支持拖拽调整
- 支持移到上一/下一波次

冲突与派发摘要：

- 同波次文件冲突
- 每个 role/repo 对应的 agent 组
- 最大并发数
- 将写入的 child task 数

主动作：

- `写入 Trellis 并派发实现`
- `返回任务复核`

确认弹窗只在有冲突时出现：

- 列出冲突文件
- 列出相关任务
- 用户确认后保存编排

## 8. 实现队列视图

用途：展示 `.trellis/tasks` 已写入，并且实现子代理正在/已经派发。

顶部摘要：

- parent tasks 数
- child tasks 数
- failedCount
- 当前 fan-out status
- workflowRunId

Wave 队列：

| 字段 | 内容 |
|---|---|
| Wave | 波次 |
| Status | waiting/running/succeeded/failed |
| Task | title |
| Task path | `.trellis/tasks/...` |
| Active task | activeTaskPath |
| Agent | trellis-implement |

主动作：

- `打开主会话任务`
- `查看任务目录`
- `返回编排`

如果实现 fan-out 失败：

- 显示失败 wave
- 显示失败 task
- 保留已写入 task path
- 允许用户去主会话手动继续

## 9. 主会话衔接

落盘完成后必须给用户明确出口。

需要呈现的能力：

- child tasks 已进入 Workspace Trellis。
- 主会话任务抽屉可以读取这些 tasks。
- 点击任务可以发送 `Active task` 到主会话。
- 也可以派给员工。

落盘完成后的推荐主 CTA：

```text
打开主会话任务
```

点击后行为：

- 进入 Chat 主会话。
- 打开任务抽屉。
- 聚焦本次 parent/child tasks。

如果当前代码暂时无法自动打开抽屉，也至少需要按钮文案说明：

```text
已写入 Trellis，可回到主会话右侧任务抽屉继续执行。
```

## 10. 状态到视图映射

| 数据状态 | 当前主视图 | 顶部主 CTA |
|---|---|---|
| 无目标 | 目标阻断 | 配置目标 |
| 无 PRD | PRD 输入 | 导入或粘贴 PRD |
| 有 PRD，无 planned summary，无 result | PRD 输入 | 生成分片预览 |
| 有 planned summary | 分片预览 | 运行拆分子代理 |
| parsing=true 或 dispatching cluster > 0 | 运行详情 | 查看运行详情 |
| 有 activeResult，未全确认 | 候选任务 | 确认可执行任务 |
| 有 activeResult，全部确认，未 materialize | 执行编排 | 写入 Trellis 并派发实现 |
| 有 materialized result | 实现队列 | 打开主会话任务 |
| cluster failed | 运行详情 | 重试失败分片 |
| fan-out failed | 实现队列 | 打开主会话手动继续 |

## 11. 信息密度规则

需求拆分助手属于高密度研发工具，不适合大块留白和营销式卡片。

规则：

- 主信息用表格、列表、状态条，不用大面积装饰卡片。
- 每个阶段只显示当前阶段的主动作。
- 技术名词可以保留，但必须配中文动作：`运行拆分子代理 trellis-splitter`。
- 文件写入边界必须始终可见。
- 错误必须带可操作出口：重试、中断、打开日志、回主会话。
- PRD 编辑器在后续阶段自动收缩，不长期占半屏。
- 运行日志是追踪透镜，不是默认占据结果区。

## 12. 最小实现切片

如果要分阶段实现，推荐先做这 5 件：

1. 改按钮文案和阶段文案：
   - `拆分` -> `生成分片预览`
   - `派发 splitter` -> `运行拆分子代理`
   - `落盘执行` -> `写入 Trellis 并派发实现`
   - `重看过程` -> `运行日志`

2. 顶部 Mission Header 增加写入边界：
   - sandbox 未写入
   - splitter 会创建 parent task
   - 已写入 child tasks

3. 右侧 Workbench 按状态分视图：
   - 分片预览
   - 运行详情
   - 候选任务
   - 执行编排
   - 实现队列

4. 候选任务改成列表 + 详情：
   - 左表快速扫
   - 右侧编辑详情
   - 降低卡片堆叠复杂度

5. 落盘完成提供主会话出口：
   - `打开主会话任务`
   - 聚焦本次 parent/child tasks

## 13. 不建议做的事

- 不把需求助手做成聊天对话页。
- 不把所有功能继续塞进两个并排卡片。
- 不隐藏 `.trellis/tasks` 写入边界。
- 不把 splitter/runtime/fan-out 都叫“执行中”。
- 不在候选任务阶段默认展示大段运行日志。
- 不用“Modern minimal”牺牲状态密度。
- 不为每个高级功能新开顶层入口。
