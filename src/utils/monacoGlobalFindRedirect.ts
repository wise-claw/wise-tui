import type { editor, IDisposable } from "monaco-editor";

let focusedMonacoEditor: editor.IStandaloneCodeEditor | null = null;

/** 记录 Monaco 聚焦态，供全局 ⌘F 重定向为编辑器内查找。 */
export function installMonacoGlobalFindRedirect(
  editorInstance: editor.IStandaloneCodeEditor,
): IDisposable {
  if (editorInstance.hasWidgetFocus()) {
    focusedMonacoEditor = editorInstance;
  }
  const onFocus = editorInstance.onDidFocusEditorWidget(() => {
    focusedMonacoEditor = editorInstance;
  });
  const onBlur = editorInstance.onDidBlurEditorWidget(() => {
    if (focusedMonacoEditor === editorInstance) {
      focusedMonacoEditor = null;
    }
  });
  return {
    dispose: () => {
      onFocus.dispose();
      onBlur.dispose();
      if (focusedMonacoEditor === editorInstance) {
        focusedMonacoEditor = null;
      }
    },
  };
}

/** Monaco 聚焦时打开内置查找框，替代 Wise 文件名搜索弹窗。 */
export function openMonacoFindIfFocused(): boolean {
  const editorInstance = focusedMonacoEditor;
  if (!editorInstance) return false;
  const action = editorInstance.getAction("actions.find");
  if (action?.isSupported()) {
    void action.run();
    return true;
  }
  editorInstance.trigger("keyboard", "actions.find", null);
  return true;
}

/** @internal 测试重置 */
export function resetMonacoGlobalFindRedirectForTests(): void {
  focusedMonacoEditor = null;
}
