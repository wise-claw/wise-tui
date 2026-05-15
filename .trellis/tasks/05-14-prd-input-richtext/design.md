# Design · PRD 输入富文本编辑器

## 1. 设计目标

- 替换两处 `Input.TextArea`，对外接口零破坏（仍是 `string` markdown）。
- 复用现有 `MilkdownEditor` + `savePrdPastedImage`，**不新增依赖**。
- 把"粘贴/拖拽图片 → 落盘 → 插入节点"从 InputStage 局部需求抽出为可复用的小组件。
- 不引入新的 markdown 序列化层（Milkdown 的 `markdownUpdated` 字符串即为真相源）。

## 2. 模块边界

```
src/components/PrdSplitWizard/
  components/
    PrdMarkdownEditor.tsx        ← 新增：薄包装，输入是 markdown 字符串，输出是 markdown 字符串
  stages/
    InputStage.tsx               ← 替换 Input.TextArea 用法
    ReviewStage.tsx              ← 替换 description 的 Input.TextArea 用法
```

`PrdMarkdownEditor` 是唯一"知道粘贴图片"的位置；其它调用方只看到 `text` / `onChange`。

## 3. PrdMarkdownEditor 接口

```ts
export interface PrdMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** 用于图片落盘 bucket 路径（来自 wizard state.project / state.selectedRepositoryIds[0]）。 */
  imageBucket: {
    repositoryPath: string;
    repositoryName: string | null;
    repositoryId: number | null;
    projectName: string | null;
    projectId: string | null;
  } | null;
  /** 多实例场景（ReviewStage 列表）传 false 关闭 Crepe 浮动工具栏。 */
  floatingToolbar?: boolean;
  /** 占位符 / 最小高度，不影响 markdown。 */
  placeholder?: string;
  minHeight?: number;
  /** 仅供锚点逻辑使用（InputStage 才需要传入），ReviewStage 不传。 */
  taskAnchors?: MilkdownTaskAnchor[];
  /** 透传 MilkdownEditor 已有锚点回调；ReviewStage 不用。 */
  selectedRequirementAnchorKey?: string | null;
  onTaskAnchorMarkerClick?: (taskId: string) => void;
  onResolvedTaskAnchorIdsChange?: (taskIds: string[]) => void;
  onTaskAnchorRangesChange?: (ranges: Record<string, AnchorRange>) => void;
  onToolbarSplitSelection?: () => void;
}
```

内部：
1. 持有 `editorRef = useRef<MilkdownEditorHandle>()`；
2. 容器 div 上挂 `onPaste`、`onDrop`、`onDragOver`；
3. 命中 image clipboard/file → 调用 `savePrdPastedImage` → 拿到 `asset://...` URL → `editorRef.current?.insertImage({ src, alt: filename })`；
4. 失败走 `antd message.error("图片保存失败：…")`，编辑器内容不变；
5. 非图片附件直接放行给浏览器默认行为（不在 DataTransfer 中找到 image MIME 时 `return` 而非 `preventDefault`）。

## 4. 数据流（lossless 证明）

```
用户键入 → Milkdown Crepe (ProseMirror)
            └─ markdownUpdated(markdown:string) ─┐
                                                  │
            insertImageCommand(src=asset://…)     │
            └─ ProseMirror image node ────────────┤
                                                  ↓
                                           PrdMarkdownEditor.onChange(markdown)
                                                  ↓
                                       api.setPrdMarkdown(markdown)
                                                  ↓
                                           state.prdMarkdown  ── splitter / anchors 读取
```

**关键不变量**：
- 编辑器吐出的 `markdown` 字符串**直接**写到 state，中间不做替换、归一化、再 parse/stringify。
- `taskAnchors.from/to` 是相对 `state.prdMarkdown` 的字符偏移；Milkdown 的 markdownUpdated 输出与 ProseMirror doc 一一对应（Milkdown 内置约束），因此偏移有定义。
- 现有 `MilkdownViewer/anchorRanges.ts` 已经在 ProseMirror doc 层做锚点定位，**不依赖 textarea 实现细节**——切换到 Milkdown 编辑器后语义保持。

## 5. 图片落盘契约

- 入口：`onPaste` / `onDrop`。
- 校验：MIME `image/*`、字节 ≤ 8 MB。
- bucket 来源：
  - InputStage：`state.project + state.selectedRepositoryIds[0]`（已选第一个仓库）；无仓库时使用 project bucket，仍走 `savePrdPastedImage`（后端有 fallback `repository_bucket_key`）。
  - ReviewStage：父任务 cluster 的 repository（任务隶属仓库）；如无则项目级 bucket。
- 文件名：`${Date.now()}-${sanitize(originalName ?? 'image.png')}`。
- 返回：`convertFileSrc(absolutePath)` → 通过 Tauri asset 协议访问。
- 插入：`editorRef.current.insertImage({ src, alt: originalName })`。

## 6. 多实例与性能（ReviewStage）

`ReviewStage` 在编辑模式下每个 TaskCard 都会渲染一个 description 编辑器。为避免一次性挂多个 Crepe：

- 默认 `floatingToolbar={false}`；
- 卡片层使用**懒挂载**：
  - 非编辑态：显示 `MilkdownViewer`（已经轻量）或直接 `Typography.Paragraph` 渲染纯 markdown 预览（首选后者，保持现状）；
  - 编辑态：才挂 `PrdMarkdownEditor`；
- TaskCard 已有 `editMode` 开关——直接复用。
- 不需要全局虚拟列表改造。

## 7. 兼容性 / 回滚

- 状态字段（`state.prdMarkdown`、`task.description`）类型与语义不变 → 可直接回滚组件而不需要 schema 迁移。
- 若 Milkdown 出现锚点漂移问题，回滚步骤：恢复 `InputStage`/`ReviewStage` 中 `Input.TextArea` 两处即可；图片包装组件可以留下，调用方退回。
- 不影响 Tauri 端：`save_prd_pasted_image` 已上线，无 schema 变更。

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Milkdown 序列化在边缘 markdown 上插空行 | 锚点 from/to 漂移 1–N 字符 | 加入「往返不变」单测（输入若干 fixture markdown → setText → 读 markdownUpdated → 应等价）；不等价时记录差异并把 fixture 标黄而非阻塞合入。 |
| 多实例 Crepe 销毁竞争 | ReviewStage 卡顿/异常 | 编辑态懒挂载 + `floatingToolbar={false}`；保留卸载 try/catch。 |
| 大图片粘贴卡顿 | UI 阻塞 | 限制 ≤ 8 MB，超限提示。 |
| 拖拽多文件 | 误传 | 仅处理第一个 image，其余忽略并提示。 |

## 9. 测试策略

- 单测：
  - `PrdMarkdownEditor.test.tsx`：粘贴 base64 image 触发 `savePrdPastedImage` mock 并插入节点；非图片粘贴透传。
  - `prdSplit/anchorEdits.test.ts` 与 `clusterPrdSlice.test.ts` 跑通（不修改）。
- 手测脚本（在 `__manual_smoke__.md` 或新建 `__manual_richtext__.md`）：
  - PRD 富文本输入 → 自动拆分 → 锚点显示位置正确。
  - 粘贴图片 → 文件落盘 → review/materialize 后 prd.md 含相对路径。
- 不启动 dev server（CLAUDE.md 项目规则）。
