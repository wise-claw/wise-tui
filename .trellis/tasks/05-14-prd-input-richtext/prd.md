# PRD 输入富文本编辑器（Milkdown，markdown lossless，含图片）

## Goal

把 PRD 拆分向导内仍在使用 `Input.TextArea` 的两处主输入框升级为 **Milkdown 富文本编辑器**，并支持**图片粘贴/拖拽**（落盘到 `~/.wise/prd-images/`）。强约束：底层仍是 markdown 字符串，`taskAnchors.from/to` 偏移与 `prdMarkdown` 字符串保持一致，**不允许引入 markdown ↔ rich text 串扰**。

## 背景

- 现状两处 `Input.TextArea`：
  - `src/components/PrdSplitWizard/stages/InputStage.tsx:106` —— 整份 PRD 输入（驱动 splitter / anchors）。
  - `src/components/PrdSplitWizard/stages/ReviewStage.tsx:655` —— 子任务 `task.description`。
- 已有可复用的内核：`src/components/MilkdownViewer/`（Crepe + Milkdown，含 anchor 插件链；`MilkdownEditor` 是 markdown lossless 受控编辑器，`text` in / `onChange(markdown)` out）。
- 已有可复用的图片管线：
  - Tauri 命令 `save_prd_pasted_image`（`src-tauri/src/claude_commands/attachments.rs:187`）
  - 前端封装 `savePrdPastedImage`（`src/services/savePrdPastedImage.ts`）
  - 物化阶段相对化：`prd_materialize.rs::rewrite_markdown_images`
- 锚点强耦合点：`src/services/prdSplit/{trellisWriter, clusterPrdSlice, splitterDispatch}.ts` 都依赖 `prdMarkdown` 原始字符偏移。

## Requirements

### 功能需求
- R1. `InputStage` 的 PRD 输入框替换为 Milkdown 富文本编辑器，对外接口仍是 `state.prdMarkdown: string` + `api.setPrdMarkdown(markdown)`；底层 markdown 完整保留（标题/列表/代码块/引用/加粗/斜体/内联代码/链接/图片/分隔线）。
- R2. `ReviewStage` 编辑模式下子任务「描述」字段替换为 Milkdown 编辑器；多实例性能可控（关闭浮动工具栏；按需懒挂载）。
- R3. 图片支持：
  - R3.1. 粘贴剪贴板图片（PNG/JPEG/GIF/WebP）。
  - R3.2. 拖拽本地图片文件到编辑器区域。
  - R3.3. 写入 `~/.wise/prd-images/<bucket>/<uuid>-<name>`，使用 `savePrdPastedImage`；编辑器内插入 `![alt](asset://…/file)` 节点，markdown 序列化为相对/绝对路径不被破坏。
- R4. 「从历史 PRD 运行导入」逻辑保留：导入后内容反映到富文本编辑器，且锚点逻辑不漂移。
- R5. 字符计数、错误提示等周边 UI 行为保留。

### 非功能需求
- N1. **锚点零回归**：`prdMarkdown` 字符串语义与现在等价；现有锚点解析（`MilkdownViewer` 内 `anchorRanges/anchorText` 等）和 `prdSplit/__tests__` 全部测试不变更地通过。
- N2. **markdown lossless**：来自 Milkdown 的 `markdownUpdated` 字符串即写入 state，不再做手工字符替换/二次序列化。
- N3. 不引入新的 UI 框架；保持 Ant Design 主体；不新增第三方 npm 依赖。
- N4. 多实例下不产生 Crepe 销毁竞争（已有 `floatingToolbar={false}` 模式）。
- N5. 大文档（≥ 100 KB markdown）输入仍可流畅编辑（输入响应 < 100 ms p95）。

### 验收标准（DoD）
- AC1. `InputStage` 中 PRD 输入由 Milkdown 渲染；输入「## 功能需求 / 列表 / 代码块 / 引用」往返后 `state.prdMarkdown` 与人工书写 markdown 等价。
- AC2. `ReviewStage` 编辑模式下任意子任务「描述」用 Milkdown 编辑；保存后 `task.description` 仍是 markdown 字符串。
- AC3. 粘贴/拖拽一张图片：本地能在 `~/.wise/prd-images/` 看到文件；编辑器中显示图片；保存后 markdown 中含 `![](asset://…)`；运行 `materialize_prd_snapshot` 后磁盘上 prd.md 的图片 src 已重写为项目相对路径。
- AC4. 全量 `bun test` 通过；`prdSplit` 子目录测试全部 PASS；锚点单测无新增失败。
- AC5. 现有「从历史 PRD 运行导入」按钮、字符计数、错误 Alert 等 UI 不变。

## Open Questions / Risks

- Q1. `ReviewStage` 卡片列表里可能同时挂多个 Crepe 实例。验收时需要在一个含 ≥ 10 个任务的拆分结果上观察首次进入"编辑模式"时的卡顿，必要时启用懒挂载（focus / 双击进入编辑态再实例化）。
- Q2. Milkdown 在表格/HTML 节点上的 markdown 序列化在某些边缘情况下会插入空行——已有 viewer 在生产环境跑得稳，但需在测试中覆盖「输入回显一致」断言。
- Q3. 拖拽图片时如果同时拖入了多个文件 / 非图片文件 / 超大文件，需在前端做尺寸/类型守门（建议 ≤ 8 MB，仅 image/*）。

## Out of Scope

- 协同编辑、版本历史。
- AI 辅助补全。
- ClusterPlanStage / TaskCard / PrdSplitPanel 等更下游输入框（description 之外）。
- 图片 EXIF 清洗、远程图床。

## Notes

- 锁链：`05-14-anchor-smart-paragraph` 依赖本任务的 AST 链；本任务先落地。
- 本任务在 `in_progress` 状态下续作；本次更新扩展了 ReviewStage 与图片粘贴的范围。
