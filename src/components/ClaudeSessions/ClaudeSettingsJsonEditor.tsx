import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { LazyMonacoEditor } from "../LazyMonacoEditor";
import {
  claudeSettingsEditorModelUri,
  configureMonacoClaudeSettingsJson,
} from "../../services/monacoClaudeSettingsJsonSchema";
import "./ClaudeSettingsJsonEditor.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readOnly?: boolean;
  /** 编辑器失焦时触发（用于失焦提交等场景）；可选。 */
  onBlur?: () => void;
  /** 透传给 Monaco 编辑器的无障碍标签；可选。 */
  ariaLabel?: string;
}

function ClaudeSettingsJsonEditorInner({ value, onChange, height = 320, readOnly, onBlur, ariaLabel }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const syncingRef = useRef(false);
  // 用 ref 持有最新 onBlur，使 onDidBlurEditorWidget 只注册一次而不持有过期闭包。
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  const handleMount = useCallback((ed: editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    editorRef.current = ed;
    configureMonacoClaudeSettingsJson(monaco);
    ed.onDidBlurEditorWidget(() => onBlurRef.current?.());
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!model || model.getValue() === value) {
      return;
    }
    syncingRef.current = true;
    model.setValue(value);
    syncingRef.current = false;
  }, [value]);

  return (
    <div className="app-claude-settings-json-editor" style={{ height }}>
      <LazyMonacoEditor
        loadingClassName="app-claude-settings-json-editor app-claude-settings-json-editor--loading"
        path={claudeSettingsEditorModelUri()}
        language="json"
        value={value}
        onChange={(next) => {
          if (syncingRef.current || readOnly) return;
          onChange(next ?? "");
        }}
        onMount={handleMount}
        options={{
          readOnly,
          ariaLabel,
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          fontSize: 12,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          formatOnPaste: true,
          formatOnType: true,
          quickSuggestions: {
            strings: true,
            other: true,
            comments: false,
          },
          suggestOnTriggerCharacters: true,
          wordBasedSuggestions: "off",
          suggest: {
            showWords: false,
            preview: true,
            showStatusBar: true,
          },
        }}
      />
    </div>
  );
}

/** Claude Code `settings.json` 编辑区（Monaco JSON + 官方 Schema 补全）。 */
export function ClaudeSettingsJsonEditor(props: Props) {
  return <ClaudeSettingsJsonEditorInner {...props} />;
}
