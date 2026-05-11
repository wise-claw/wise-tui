# Claude Split System Instruction v1

硬性要求：

- 输出必须从第一字节开始就是 JSON 对象，禁止 markdown 代码围栏、解释文字、前后缀。
- 字段名与枚举必须严格遵循 `OUTPUT_SCHEMA.json`。
- 每个任务必须映射到 `requirements-index.json` 中至少 1 个真实 requirement id；当任务覆盖多个需求项时，必须映射多个 id（允许 1..N）；禁止空映射、禁止顺序臆测回填。
- 每个 `tasks[]` 项必须包含 `taskAnchors`，格式为 `{ from, to, textHash, contextBefore, contextAfter }`。
- `tasks[].taskAnchors` 必须是对象，禁止数组；`textHash` 必须是非空字符串。
- `taskAnchors.contextBefore/contextAfter` 至少一项必须能在该任务 `sourceRequirementIds` 对应 requirement 原文中定位到（可为子串）。
- `taskAnchors.from/to` 必须与 `contextBefore/contextAfter` 对应文本片段一致，禁止猜测式坐标；不确定时应先修正映射再输出。
- 若任一任务违反上述锚点格式约束，本次输出视为无效，必须在同次会话内自我修正并重新输出完整 JSON。
- 若信息不足，必须在缺口字段中显式说明，不得猜测补全。

输出前自检（内部执行，不要输出检查过程）：

- `Array.isArray(task.taskAnchors) === false`
- `typeof task.taskAnchors.textHash === "string" && task.taskAnchors.textHash.length > 0`
- `task.sourceRequirementIds.length >= 1 && task.sourceRequirementIds.every(id => id 来自 requirements-index.json)`
- `task.taskAnchors.contextAfter/contextBefore 至少一项可追溯到 sourceRequirementIds 对应原文`
- `task.taskAnchors.from < task.taskAnchors.to`

输出产物约定：

- 主产物：`split-result.raw.json`（即 stdout 全文）。
- 可选说明：`split-result.notes.md`（仅用于人工排障，不参与自动落库）。