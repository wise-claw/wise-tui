import Editor from "@monaco-editor/react";
import { Spin } from "antd";
import { Suspense } from "react";
import "./ClaudeSettingsJsonEditor.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readOnly?: boolean;
}

function ClaudeSettingsJsonEditorInner({ value, onChange, height = 320, readOnly }: Props) {
  return (
    <div className="app-claude-settings-json-editor" style={{ height }}>
      <Editor
        language="json"
        value={value}
        onChange={(next) => {
          if (!readOnly) onChange(next ?? "");
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          formatOnPaste: true,
          formatOnType: true,
        }}
      />
    </div>
  );
}

/** Claude Code `settings.json` 编辑区（Monaco JSON）。 */
export function ClaudeSettingsJsonEditor(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="app-claude-settings-json-editor app-claude-settings-json-editor--loading">
          <Spin size="small" />
        </div>
      }
    >
      <ClaudeSettingsJsonEditorInner {...props} />
    </Suspense>
  );
}
