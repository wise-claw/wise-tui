# Implement · PRD 输入富文本编辑器

## 执行顺序

> 每完成一步都立即跑 `bun test --filter prdSplit` 至少 smoke；最后一步跑全量 `bun test`。
> **禁止启动 dev/build/start/serve**（CLAUDE.md 项目规则）。

### Step 1 · 新增 `PrdMarkdownEditor` 包装组件
- 路径：`src/components/PrdSplitWizard/components/PrdMarkdownEditor.tsx`
- 实现：
  - `forwardRef` 透传 `MilkdownEditorHandle`（InputStage 需要 `scrollToRequirementSnippet` / `highlightTaskAnchorRange` 等）。
  - 容器 div 上：
    - `onPaste`: 遍历 `e.clipboardData.items`，命中 `image/*` 时 `e.preventDefault()`，读 `getAsFile()`、`FileReader.readAsDataURL` → 调 `savePrdPastedImage` → `editorRef.current?.insertImage({ src, alt })`。失败 `message.error`。
    - `onDrop` / `onDragOver`: 同上，处理 `e.dataTransfer.files[0]`，仅当 MIME 是 `image/*` 时拦截。
  - 守门：单文件、≤ 8 MB、`image/*`；超限 `message.warning`。
- 验收：单元测试覆盖粘贴图片 happy path + 非图片透传。

### Step 2 · 接入 InputStage
- 路径：`src/components/PrdSplitWizard/stages/InputStage.tsx`
- 改动：
  - 删除 `Input.TextArea` 用法（保留外层 `Card` / `Tooltip` / 字符计数 / 历史按钮）。
  - 替换为：
    ```tsx
    <PrdMarkdownEditor
      value={state.prdMarkdown}
      onChange={api.setPrdMarkdown}
      imageBucket={resolveInputStageBucket(state)}
      floatingToolbar
      placeholder="粘贴 PRD 全文。建议包含「## 功能需求 / ## 非功能需求 / ## 验收标准」三段。"
      minHeight={320}
    />
    ```
  - 新增本地纯函数 `resolveInputStageBucket(state)` 从 `state.project` 与第一个选中仓库构造 bucket（无选中仓库时 repositoryPath/Name/Id 全部 null）。
  - 字符计数继续读 `state.prdMarkdown.length`。
- 验收：粘贴 markdown 文本，state 中字符串与可视化文本等价；插入图片 → state 含 `![](asset://…)`。

### Step 3 · 接入 ReviewStage 子任务描述
- 路径：`src/components/PrdSplitWizard/stages/ReviewStage.tsx:655`
- 改动：
  - 仅替换 `editMode === true` 分支中的 `Input.TextArea`：
    ```tsx
    <PrdMarkdownEditor
      value={task.description}
      onChange={(md) => onPatch("description", md)}
      imageBucket={resolveTaskBucket(task)}
      floatingToolbar={false}
      placeholder="任务描述（Markdown）"
      minHeight={120}
    />
    ```
  - `resolveTaskBucket(task)`：从 `task.repositoryId` 反查仓库；如无 → 退回项目 bucket。
- 验收：在含 ≥ 5 任务的拆分结果上手测，编辑切换无显著卡顿；保存后 `task.description` 仍为 markdown。

### Step 4 · markdown lossless 回归
- 新增 `src/components/PrdSplitWizard/components/PrdMarkdownEditor.roundtrip.test.tsx`（或就近测试）：
  - 选取 3–5 份 fixture（含标题、有序/无序列表、代码块、引用、图片、链接、加粗/斜体）。
  - 模拟 `MilkdownEditor` 接收 → 触发 `markdownUpdated` → 断言输出与输入等价。
  - 如不等价记录差异并在 PRD `Open Questions` 中追加（不阻塞合入）。
- 跑 `prdSplit/{anchorEdits,clusterPrdSlice,trellisWriter,splitterDispatch}*.test.ts` 全绿。

### Step 5 · 文档与 spec 同步
- 在 `.trellis/spec/frontend/index.md`（若该 spec 涉及编辑器选型）追加 1 行：PRD/任务描述 markdown 输入统一使用 `PrdMarkdownEditor`（Milkdown）。
- 在任务目录追加 `__manual_richtext__.md`（手测脚本）。

## 验证矩阵

| 命令 | 期望 |
|---|---|
| `bun test` | 全绿 |
| `bun test src/services/prdSplit` | 全绿，零新增失败 |
| `bun test src/components/PrdSplitWizard` | 包含新 PrdMarkdownEditor 单测，全绿 |

## 回滚点

- 任何 step 失败：保留 `PrdMarkdownEditor.tsx` 文件，回滚 `InputStage.tsx` / `ReviewStage.tsx` 的两处 import + JSX 即可。
- 不涉及 Tauri / DB / 文件 schema 变更，无数据迁移风险。

## Review Gates

- Gate 1（Step 1 后）：`PrdMarkdownEditor` 单元测试通过 + 类型检查通过；先不接入。
- Gate 2（Step 2 后）：InputStage 手测：原 PRD markdown 黏贴回显一致；锚点高亮在拆分后可见。
- Gate 3（Step 3 后）：ReviewStage 多任务编辑场景无卡顿、无 Crepe 报错。
- Gate 4（Step 4 后）：lossless 回归 + 全量 bun test 全绿后再进入 finish 阶段。
