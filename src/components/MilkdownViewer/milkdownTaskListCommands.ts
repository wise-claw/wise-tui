import type { Editor } from "@milkdown/kit/core";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  clearTextInCurrentBlockCommand,
  listItemSchema,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";

/** 将当前块转为未完成任务项（与 Crepe 斜杠菜单「Task List」一致）。 */
export function wrapTaskListItem(editor: Editor): void {
  editor.action((ctx) => {
    const commands = ctx.get(commandsCtx);
    const listItem = listItemSchema.type(ctx);
    commands.call(clearTextInCurrentBlockCommand.key);
    commands.call(wrapInBlockTypeCommand.key, {
      nodeType: listItem,
      attrs: { checked: false },
    });
  });
}

/** 切换光标所在任务项的勾选状态；非任务项时 no-op。 */
export function toggleTaskListItemChecked(editor: Editor): boolean {
  let toggled = false;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "list_item" || node.attrs.checked == null) continue;
      const pos = $from.before(depth);
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }),
      );
      toggled = true;
      return;
    }
  });
  return toggled;
}

/** 光标是否位于任务项内。 */
export function isTaskListItemActive(editor: Editor): boolean {
  let active = false;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "list_item" && node.attrs.checked != null) {
        active = true;
        return;
      }
    }
  });
  return active;
}
