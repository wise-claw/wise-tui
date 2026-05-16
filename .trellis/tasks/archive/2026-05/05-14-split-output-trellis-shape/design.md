# Design · split-output-trellis-shape

## 设计目标

让 splitter 在派发阶段就为每个 child 任务输出 `classification + designMarkdown + implementMarkdown` 三件套，落盘时按 classification 写对应文件。MVP 仅扩 schema / 写盘 / prompt，不动 Review UI 编辑面（留 follow-up）。

## 数据契约

### OUTPUT_SCHEMA 扩展

在 `splitterDispatch.ts:259-329` 的 task 子对象 `properties` 中加：

```jsonc
{
  classification: { enum: ["lightweight", "complex"] },
  designMarkdown: { type: "string" },     // complex 必填，非空
  implementMarkdown: { type: "string" }   // complex 必填，非空
}
```

`required` 不加 classification（保持向后兼容；缺省视为 `lightweight`）。

### TaskItem 类型扩展（`src/types.ts`）

```ts
export interface TaskItem {
  // ...既有字段
  classification?: "lightweight" | "complex";
  designMarkdown?: string;
  implementMarkdown?: string;
}
```

### normalizer 通过策略

`normalizeClaudeSplitOutputToSplitResult` 与 `validateClaudeSplitPayloadStrict`：

- normalizer 直接 pass-through 新字段，缺省时设 `classification = "lightweight"`。
- strict validator 加约束：`classification === "complex"` 时 `designMarkdown.trim()` 与 `implementMarkdown.trim()` 都必须 ≥ 1 char。
- 对 `classification === "lightweight"` 但同时附 design/implement：不报错，原样写下。

### Rust ChildTaskPayload 扩展

`src-tauri/src/claude_commands/prd_split_pipeline.rs:45-60`：

```rust
pub(crate) struct ChildTaskPayload {
    // ...既有字段
    #[serde(default)]
    classification: Option<String>,
    #[serde(default)]
    design_markdown: Option<String>,
    #[serde(default)]
    implement_markdown: Option<String>,
}
```

`prd_split_materialize_tasks` 在写 `prd.md` 之后：

- 若 `design_markdown` 非空 → 写 `design.md`。
- 若 `implement_markdown` 非空 → 写 `implement.md`。
- task.json.meta 加 `classification` 字段。

### trellisWriter 投影

`buildMaterializePayload.projectChildTask` 把新字段透传给 RustChildTaskPayload。

## Prompt 修订

`splitterDispatch.ts:172-206 composeSplitterPrompt`：

- 在 schema 强约束块前加章节 **「## 分类与设计输出要求」**：
  - lightweight：subtasks ≤ 3 且不跨仓 且 dod ≤ 3 → 仅给 prd 字段，**可省略** design / implement。
  - complex：其余情况 → 必须给 `classification: "complex"` + 非空 `designMarkdown` + 非空 `implementMarkdown`。
  - 给出 `designMarkdown` 期望章节：Architecture / Data Contract / Compatibility / Risks。
  - 给出 `implementMarkdown` 期望章节：Ordered steps / Validation commands / Rollback points。

## 兼容性

- 旧 splitter 输出（无 classification）→ normalizer 默认 lightweight → 写盘只产 prd.md，与现状一致。
- 旧 wizard 已落盘的子任务不受影响（无文件迁移）。
- task.json 新字段 `meta.classification` 是补充信息，task.py 不读它。

## 失败模式

- splitter 给了 `classification: "complex"` 但 designMarkdown 空 → strict validator 拒绝 → cluster 标 issue，用户可派 verifier 修复（既有路径）。
- splitter 给了垃圾 markdown → 仍按字面值写入；用户可在子任务激活前编辑。

## 不在范围

- Review UI 内编辑 design/implement 字段（follow-up）。
- check.jsonl / implement.jsonl 由 splitter 产出（暂不做；让子任务进 Phase 2 后由 trellis-implement 子代理自治 curate）。
- 自动 LLM 评估 classification 准确度。
