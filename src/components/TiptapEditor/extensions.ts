import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/extension-bubble-menu";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import type { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { createLowlight, common } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { WiseImage } from "./image";

const lowlight = createLowlight(common);

/** 切换光标所在任务项勾选状态；非任务项时 no-op。 */
export function toggleTaskItemChecked(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "taskItem") continue;
    const pos = $from.before(depth);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: !node.attrs.checked,
      }),
    );
    return true;
  }
  return false;
}

/** 兼容旧版交互：任务项内按 Enter 切换勾选；Mod+Shift+T 包裹任务列表。 */
export const WiseShortcuts = Extension.create({
  name: "wiseEditorShortcuts",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-T": () => this.editor.commands.toggleTaskList(),
      Enter: () => {
        if (this.editor.isActive("taskItem")) {
          return toggleTaskItemChecked(this.editor);
        }
        return false;
      },
    };
  },
});

export interface TiptapExtensionsOptions {
  placeholder?: string;
  /** 任务锚点/高亮装饰插件（由宿主持有 refs 创建）。 */
  decorationsPlugin?: Plugin;
}

/** 语雀风格编辑器扩展集合（可独立复用，便于测试与多实例共享配置）。 */
export function buildTiptapExtensions(options: TiptapExtensionsOptions = {}) {
  const extensions: unknown[] = [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      dropcursor: { color: "var(--ant-color-primary)", width: 2 },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    WiseImage,
    Placeholder.configure({ placeholder: options.placeholder ?? "写点什么…" }),
    BubbleMenu,
    WiseShortcuts,
    Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
  ];
  if (options.decorationsPlugin) {
    const plugin = options.decorationsPlugin;
    extensions.push(
      Extension.create({
        name: "wiseDecorations",
        addProseMirrorPlugins() {
          return [plugin];
        },
      }),
    );
  }
  return extensions as AnyExtension[];
}
