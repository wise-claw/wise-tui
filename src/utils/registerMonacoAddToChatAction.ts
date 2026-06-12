import type { editor } from "monaco-editor";

/** 注册 Monaco「添加到聊天」快捷键（默认 ⌘L / Ctrl+L，需有选区）。 */
export function registerMonacoAddToChatAction(
  editor: editor.IStandaloneCodeEditor,
  monaco: typeof import("monaco-editor"),
  onAdd: () => void,
): void {
  editor.addAction({
    id: "wise.monaco.add-selection-to-chat",
    label: "添加到聊天",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
    precondition: "editorHasSelection",
    run: () => {
      onAdd();
    },
  });
}
