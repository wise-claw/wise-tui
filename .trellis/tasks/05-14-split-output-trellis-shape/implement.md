# Implement · split-output-trellis-shape

## Step 1 · TS 类型 + schema + normalizer

- 编辑 `src/types.ts`：`TaskItem` 加 `classification` / `designMarkdown` / `implementMarkdown` 可选字段。
- 编辑 `src/services/prdSplit/splitterDispatch.ts:259-329` 的 `OUTPUT_SCHEMA_JSON`：在 task 子对象 `properties` 加三个字段，**不**加到 `required`。
- 编辑 `src/services/claudeSplitOutputNormalize.ts`：
  - validator strict 路径：若 `classification === "complex"`，校验 designMarkdown / implementMarkdown 非空。
  - normalizer：pass-through，缺省 `classification = "lightweight"`。
- 测试：扩展 `claudeSplitOutputNormalize.test.ts`（如有）覆盖新约束。否则新建。

验收：`bun test src/services/claudeSplitOutputNormalize.test.ts` + `bunx tsc --noEmit`。

## Step 2 · trellisWriter 投影

- 编辑 `src/services/prdSplit/trellisWriter.ts`：
  - `RustChildTaskPayload` interface 加 `classification` / `designMarkdown` / `implementMarkdown`。
  - `projectChildTask` 把三个字段从 `TaskItem` 透传。
- 测试：扩展 `trellisWriter.test.ts` 覆盖新字段透传。

## Step 3 · Rust 写盘

- 编辑 `src-tauri/src/claude_commands/prd_split_pipeline.rs`：
  - `ChildTaskPayload` 加三个字段（`#[serde(default)]`）。
  - `prd_split_materialize_tasks` 在写 prd.md 后：design_markdown 非空写 `design.md`；implement_markdown 非空写 `implement.md`；task.json.meta 加 `classification`。
- 测试：`cargo test --manifest-path src-tauri/Cargo.toml`（已有 testset 应跑通，新增字段不破坏）。

## Step 4 · Prompt 修订

- 编辑 `src/services/prdSplit/splitterDispatch.ts:composeSplitterPrompt`：加分类与设计输出要求章节。
- 不需要测试（prompt 是字符串）。
- 视情况更新 `.trellis/spec/guides/trellis-splitter-prompt.md`（如有引用）。

## Step 5 · 整合验收

```bash
bun test
bunx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

## Step 6 · Commit

按 `feat(prd-split): output trellis-shape design/implement for complex children` 收尾。
