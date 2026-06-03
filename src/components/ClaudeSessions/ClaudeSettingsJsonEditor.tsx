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
}

function ClaudeSettingsJsonEditorInner({ value, onChange, height = 320, readOnly }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const syncingRef = useRef(false);

  const handleMount = useCallback((ed: editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    editorRef.current = ed;
    configureMonacoClaudeSettingsJson(monaco);
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
