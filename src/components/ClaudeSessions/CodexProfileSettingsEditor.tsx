import { useEffect, useId, useRef } from "react";
import { Button, Popconfirm } from "antd";
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
  onClearAuthJson?: () => void;
  onClearConfigToml?: () => void;
  /** 清空会直接写入用户级配置文件时，弹确认框防止误触 */
  confirmClear?: boolean;
  compact?: boolean;
}

function ClearFileButton({
  fileLabel,
  confirm,
  onClear,
}: {
  fileLabel: string;
  confirm?: boolean;
  onClear?: () => void;
}) {
  if (!onClear) return null;
  const button = (
    <Button
      type="text"
      size="small"
      className="app-codex-profile-settings-editor__clear-btn"
      onClick={onClear}
    >
      清空
    </Button>
  );
  if (!confirm) return button;
  return (
    <Popconfirm
      title={`清空 ${fileLabel}`}
      description="将直接写入用户级配置文件，不可恢复"
      okText="清空"
      cancelText="取消"
      onConfirm={onClear}
    >
      {button}
    </Popconfirm>
  );
}

export function CodexProfileSettingsEditor({
  authJson,
  configToml,
  onAuthJsonChange,
  onConfigTomlChange,
  onClearAuthJson,
  onClearConfigToml,
  confirmClear = false,
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
          <div className="app-codex-profile-settings-editor__section-actions">
            {!compact ? (
              <span className="app-codex-profile-settings-editor__section-hint">API Key 与认证方式</span>
            ) : null}
            <ClearFileButton fileLabel="auth.json" confirm={confirmClear} onClear={onClearAuthJson} />
          </div>
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
          <div className="app-codex-profile-settings-editor__section-actions">
            {!compact ? (
              <span className="app-codex-profile-settings-editor__section-hint">模型、MCP 与项目信任等</span>
            ) : null}
            <ClearFileButton fileLabel="config.toml" confirm={confirmClear} onClear={onClearConfigToml} />
          </div>
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
