import { useEffect, useId, useRef } from "react";
import { LazyMonacoEditor } from "../LazyMonacoEditor";
import "./CodexProfileSettingsEditor.css";

interface MonacoEditorProps {
  language: "json" | "toml";
  value: string;
  onChange: (value: string) => void;
  height: number;
  path: string;
}

function MonacoTextEditorInner({ language, value, onChange, height, path }: MonacoEditorProps) {
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const syncingRef = useRef(false);

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
    <div className="app-codex-profile-settings-editor__pane" style={{ height }}>
      <LazyMonacoEditor
        loadingClassName="app-codex-profile-settings-editor__pane app-codex-profile-settings-editor__pane--loading"
        path={path}
        language={language}
        value={value}
        onChange={(next) => {
          if (syncingRef.current) return;
          onChange(next ?? "");
        }}
        onMount={(ed) => {
          editorRef.current = ed;
        }}
        options={{
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          fontSize: 12,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          formatOnPaste: language === "json",
          formatOnType: language === "json",
        }}
      />
    </div>
  );
}

function MonacoTextEditor(props: MonacoEditorProps) {
  return <MonacoTextEditorInner {...props} />;
}

interface Props {
  authJson: string;
  configToml: string;
  onAuthJsonChange: (value: string) => void;
  onConfigTomlChange: (value: string) => void;
  compact?: boolean;
}

export function CodexProfileSettingsEditor({
  authJson,
  configToml,
  onAuthJsonChange,
  onConfigTomlChange,
  compact = false,
}: Props) {
  const id = useId().replace(/:/g, "");
  const authHeight = compact ? 72 : 112;
  const configHeight = compact ? 128 : 200;

  return (
    <div
      className={
        compact
          ? "app-codex-profile-settings-editor app-codex-profile-settings-editor--compact"
          : "app-codex-profile-settings-editor"
      }
    >
      <section className="app-codex-profile-settings-editor__section">
        <div className="app-codex-profile-settings-editor__section-head">
          <label className="app-claude-model-topbar-panel__label">auth.json</label>
          {!compact ? (
            <span className="app-codex-profile-settings-editor__section-hint">API Key 与认证方式</span>
          ) : null}
        </div>
        <MonacoTextEditor
          path={`wise-codex-auth-${id}.json`}
          language="json"
          value={authJson}
          onChange={onAuthJsonChange}
          height={authHeight}
        />
      </section>
      <section className="app-codex-profile-settings-editor__section">
        <div className="app-codex-profile-settings-editor__section-head">
          <label className="app-claude-model-topbar-panel__label">config.toml</label>
          {!compact ? (
            <span className="app-codex-profile-settings-editor__section-hint">模型、MCP 与项目信任等</span>
          ) : null}
        </div>
        <MonacoTextEditor
          path={`wise-codex-config-${id}.toml`}
          language="toml"
          value={configToml}
          onChange={onConfigTomlChange}
          height={configHeight}
        />
      </section>
    </div>
  );
}
