# 手工回归脚本（团队流程编排融合）

适用范围：`llm-structured-decision-pipeline` 方案落地后，验证“结构化 verdict 门闸”与现有团队流程编排融合是否正确。

---

## 0. 测试准备

- [ ] 已有可运行的团队流程模板，包含至少一个 `approval` 节点且 `acceptance_enabled` 生效。
- [ ] 测试仓库有可触发长回复的任务（>= 30k 字符更佳）。
- [ ] 可查看阶段执行记录与任务时间线（`WorkflowTaskTimeline`）。
- [ ] 功能开关可配置（预期有 `wise.workflow.verdict.mode`）。

建议记录：
- `taskId`
- 当前 `nodeId`
- 会话 `sessionId` / `claudeSessionId`
- 关键时间戳（提交、完成、推进）

---

## 1. 基线流程：结构化通过

### 步骤

1. 发起一条团队流程任务，推进到 `approval` 节点。
2. 让模型回复末尾输出合法 JSON，例如：
   ```json
   {"workflowAcceptanceVerdict":"approve","taskId":"<taskId>","nodeId":"<nodeId>"}
   ```
3. 等待 `handleClaudeTurnComplete` 触发自动判定。

### 预期

- [ ] 自动进入“通过”分支，调用 `decideWorkflowTaskStage`。
- [ ] 阶段执行记录与时间线出现对应推进。
- [ ] 若已接入 verdict 事件：可看到 `workflow_acceptance_verdict_submitted`（或约定名称）且 payload 合法。

---

## 2. 基线流程：结构化驳回

### 步骤

1. 同样推进到 `approval` 节点。
2. 回复末尾输出：
   ```json
   {"workflowAcceptanceVerdict":"reject","taskId":"<taskId>","nodeId":"<nodeId>"}
   ```

### 预期

- [ ] 进入“驳回/回退”分支。
- [ ] 团队详情“阶段执行记录”中可看到回退派发链路完整（不应只停在待执行）。
- [ ] 任务状态与待派发员工与流程定义一致。

---

## 3. 长文场景：正文超长但末尾结论正确

### 步骤

1. 构造超长正文（建议 100k+ 字符），将合法 verdict JSON 放在**末尾**。
2. 触发完成回调。

### 预期

- [ ] 仍能正确解析 verdict 并分支。
- [ ] 不因尾窗限制导致“无法判断”。
- [ ] 日志中 `parseOk=true`（若有该字段）。

---

## 4. 兼容写法：裸值 / 单引号

### 用例 A：裸值
```json
{"workflowAcceptanceVerdict":approve}
```

### 用例 B：单引号
```json
{'workflowAcceptanceVerdict':'reject'}
```

### 预期

- [ ] 系统按兼容策略解析成功（若方案声明支持）。
- [ ] 分支结果与值一致。

---

## 5. 非法/缺失 verdict：应安全失败

### 步骤

1. 仅输出自然语言，不含结构化 verdict。
2. 或输出非法值（如 `maybe`）。

### 预期

- [ ] 不自动推进阶段（不应误通过/误驳回）。
- [ ] 有可见提示：需人工验收或待处理。
- [ ] 不出现“静默卡死”。
- [ ] `workflow_acceptance_verdict_unresolved` 事件存在，且 `reason` 符合当前模式：
  - `structured_only` 且无 `structuredVerdict`：`structured_missing`
  - `structured_only` 且 `structuredVerdict` 非法：`structured_invalid`
  - 其他模式：`parse_failed`

---

## 5.1 structured_only 失败原因细分（新增必测）

### 用例 A：`structured_missing`

步骤：

1. 设置 `wise.workflow.verdict.mode=structured_only`。
2. 推进到 `approval` 节点，确保本轮 completion payload 不带 `structuredVerdict`。
3. 等待自动判定结束并查看任务事件。

预期：

- [ ] 写入 `workflow_acceptance_verdict_unresolved`。
- [ ] 事件 payload 中 `reason=structured_missing`。
- [ ] `verdictSource=structured_only`，`verdictMode=structured_only`。
- [ ] 不触发 `decideWorkflowTaskStage` 自动通过/驳回。

### 用例 B：`structured_invalid`

步骤：

1. 保持 `wise.workflow.verdict.mode=structured_only`。
2. 推进到 `approval` 节点，注入非法 `structuredVerdict`（例如 verdict 值为 `maybe` 或字段缺失）。
3. 等待自动判定结束并查看任务事件。

预期：

- [ ] 写入 `workflow_acceptance_verdict_unresolved`。
- [ ] 事件 payload 中 `reason=structured_invalid`。
- [ ] `verdictSource=structured_only`，`verdictMode=structured_only`。
- [ ] 阶段不自动推进，状态进入人工处理路径。

### 用例 C：非 `structured_only` 下仍为 `parse_failed`

步骤：

1. 切换到 `structured_plus_extractor`（默认）或 `heuristic`。
2. 构造无法解析的输出（无结论或非法结论）。
3. 查看 unresolved 事件。

预期：

- [ ] `reason=parse_failed`。
- [ ] `verdictSource` 与模式匹配（默认常见为 `output_fallback`）。

## 6. 幂等与重复事件（前后端）

### 步骤（可执行）

1. 准备一条会触发自动验收的消息，确保能生成稳定 payload：
   - `workflowAcceptanceVerdict`
   - `graphNodeId` / `nodeId`
   - `correlationId`
   - `payloadSha256`
2. 等第一次完成回调后，在 UI 中确认已写入一次 `workflow_acceptance_verdict_submitted`（或 `unresolved`）事件。
3. **模拟同轮重放**（二选一）：
   - A. 通过调试手段/脚本重复触发同一轮 `onClaudeTurnComplete`（session、output 保持不变）；
   - B. 调用 `append_task_event` 人工重放同一 `taskId + eventType + graphNodeId + correlationId` 的 payload。
4. 重新拉取事件列表（`list_task_events`）并对比重复写入前后：
   - 记录首条命中事件的 `id`；
   - 检查重放后的返回 `id` 是否相同（后端冲突回收路径）。
5. 观察任务阶段与时间线，确认没有额外 `decideWorkflowTaskStage` 副作用。

### 预期

- [ ] 同一 `taskId + nodeId/graphNodeId + correlationId` 只推进一次。
- [ ] 前端 guard 命中时，日志可见 `team.decision.duplicate_completion_skipped`（开启 trace 时）。
- [ ] 后端唯一约束命中时，`append_task_event` 返回已存在事件（同一 `event id`），而不是新增事件。
- [ ] 时间线与 DB 中不出现重复推进副作用。

---

## 7. 开关回滚验证

### 步骤

1. 设置 `wise.workflow.verdict.mode=heuristic`（或项目定义的回滚模式）。
2. 重跑“结构化通过/驳回”与“非法 verdict”用例。
3. 额外检查 unresolved `reason` 是否回到 `parse_failed`（非 structured_only 细分路径）。

### 预期

- [ ] 行为回到旧策略（与变更前一致）。
- [ ] 恢复新模式后行为再次符合新策略。
- [ ] `reason` 字段与当前模式一致（无跨模式污染）。

---

## 8. 观察点清单（建议截图/日志留档）

- [ ] `handleClaudeTurnComplete` 触发时的输入摘要（长度、session、task）。
- [ ] verdict 解析结果（字段、schemaVersion、parseOk）。
- [ ] `appendTaskEvent` 是否写入且类型正确。
- [ ] unresolved 事件 `reason / verdictSource / verdictMode / acceptanceGate` 是否与预期一致。
- [ ] `decideWorkflowTaskStage` 调用次数与参数。
- [ ] UI：阶段执行记录、时间线、当前阶段与待执行人一致性。

---

## 9. 退出标准

- [ ] 第 1～7 节所有必测项通过。
- [ ] 无“长文导致误判/漏判”的可复现路径。
- [ ] 无重复推进（幂等）问题。
- [ ] 回滚开关可用。
