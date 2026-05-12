import { Alert, Button, Input, Radio, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLAUDE_USER_CONFIG_DIR_PRESETS,
  type ClaudeUserConfigDirInfo,
  getClaudeUserConfigDir,
  setClaudeUserConfigDir,
} from "../../services/claudeConfigDir";
import "./index.css";

type ChoiceKey = "default" | "codefuse" | "custom";

interface InternalState {
  choice: ChoiceKey;
  customDraft: string;
}

function classifyRawValue(rawValue: string | null): ChoiceKey {
  const v = rawValue?.trim() ?? "";
  if (v.length === 0) return "default";
  const codefuse = CLAUDE_USER_CONFIG_DIR_PRESETS.find((p) => p.key === "codefuse");
  if (codefuse?.rawValue === v) return "codefuse";
  return "custom";
}

function buildDirty(state: InternalState, info: ClaudeUserConfigDirInfo): boolean {
  const currentChoice = classifyRawValue(info.rawValue);
  if (state.choice !== currentChoice) return true;
  if (state.choice === "custom") {
    return state.customDraft.trim() !== (info.rawValue ?? "").trim();
  }
  return false;
}

export function ClaudeConfigDirPanel() {
  const [info, setInfo] = useState<ClaudeUserConfigDirInfo | null>(null);
  const [state, setState] = useState<InternalState>({ choice: "default", customDraft: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getClaudeUserConfigDir();
      if (!aliveRef.current) return;
      setInfo(next);
      const choice = classifyRawValue(next.rawValue);
      setState({
        choice,
        customDraft: choice === "custom" ? next.rawValue ?? "" : "",
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  const handleChoiceChange = useCallback(
    (next: ChoiceKey) => {
      setState((prev) => {
        if (prev.choice === next) return prev;
        if (next === "custom") {
          const seed = info?.rawValue && classifyRawValue(info.rawValue) === "custom" ? info.rawValue : "";
          return { choice: next, customDraft: seed };
        }
        return { choice: next, customDraft: "" };
      });
    },
    [info?.rawValue],
  );

  const handleSave = useCallback(async () => {
    if (!info) return;
    let pendingValue: string | null;
    if (state.choice === "default") {
      pendingValue = null;
    } else if (state.choice === "codefuse") {
      pendingValue = CLAUDE_USER_CONFIG_DIR_PRESETS.find((p) => p.key === "codefuse")?.rawValue ?? null;
    } else {
      const trimmed = state.customDraft.trim();
      if (!trimmed) {
        message.warning("请填写自定义路径，或选择上方预设。");
        return;
      }
      pendingValue = trimmed;
    }
    setSaving(true);
    try {
      const next = await setClaudeUserConfigDir(pendingValue);
      if (!aliveRef.current) return;
      setInfo(next);
      const choice = classifyRawValue(next.rawValue);
      setState({ choice, customDraft: choice === "custom" ? next.rawValue ?? "" : "" });
      message.success("已保存配置目录，后续 Claude Code 工具会立即按新路径解析。");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [info, state]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    try {
      const next = await setClaudeUserConfigDir(null);
      if (!aliveRef.current) return;
      setInfo(next);
      setState({ choice: "default", customDraft: "" });
      message.success("已恢复为默认 ~/.claude。");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, []);

  const dirty = useMemo(() => (info ? buildDirty(state, info) : false), [info, state]);

  if (loading && !info) {
    return <div className="app-claude-config-dir-panel">加载中…</div>;
  }
  if (!info) {
    return <div className="app-claude-config-dir-panel">无法读取当前配置，请重试。</div>;
  }

  return (
    <div className="app-claude-config-dir-panel">
      <Typography.Paragraph type="secondary" className="app-claude-config-dir-panel__intro">
        Wise 默认从 <Typography.Text code>~/.claude</Typography.Text> 读取 Claude Code
        的本机配置（settings.json、agents、skills、hooks、plugins/marketplaces/cache、projects 等）。
        如果你正在使用 <Typography.Text code>codefuse engine cc</Typography.Text>
        等同源 fork，可以切换到对应目录，
        其下的同名子目录会自动接管。<strong>仅影响用户级目录</strong>；仓库内的{" "}
        <Typography.Text code>&lt;repo&gt;/.claude/</Typography.Text> 保持不变。
      </Typography.Paragraph>

      <div className="app-claude-config-dir-panel__current">
        <Typography.Text strong>当前生效</Typography.Text>
        <div className="app-claude-config-dir-panel__current-row">
          <Typography.Text code>{info.resolvedPath}</Typography.Text>
          {info.isDefault ? <Tag color="default">默认</Tag> : <Tag color="processing">自定义</Tag>}
          {info.exists ? <Tag color="success">目录存在</Tag> : <Tag color="warning">目录暂不存在</Tag>}
        </div>
        {!info.isDefault ? (
          <Typography.Text type="secondary" className="app-claude-config-dir-panel__current-default">
            默认路径：<Typography.Text code>{info.defaultResolvedPath}</Typography.Text>
          </Typography.Text>
        ) : null}
      </div>

      <Radio.Group
        value={state.choice}
        onChange={(e) => handleChoiceChange(e.target.value as ChoiceKey)}
        className="app-claude-config-dir-panel__choices"
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {CLAUDE_USER_CONFIG_DIR_PRESETS.map((preset) => (
            <Radio key={preset.key} value={preset.key} className="app-claude-config-dir-panel__choice">
              <div className="app-claude-config-dir-panel__choice-body">
                <Typography.Text strong>{preset.label}</Typography.Text>
                <Typography.Text type="secondary" className="app-claude-config-dir-panel__choice-desc">
                  {preset.description}
                </Typography.Text>
              </div>
            </Radio>
          ))}
          <Radio value="custom" className="app-claude-config-dir-panel__choice">
            <div className="app-claude-config-dir-panel__choice-body">
              <Typography.Text strong>自定义路径</Typography.Text>
              <Typography.Text type="secondary" className="app-claude-config-dir-panel__choice-desc">
                支持以 <Typography.Text code>~</Typography.Text> 开头或绝对路径；目录可暂不存在（首次使用 Claude Code 时会自动创建）。
              </Typography.Text>
              <Input
                size="small"
                placeholder="例如：~/.codefuse/engine/cc 或 /Users/me/.claude"
                disabled={state.choice !== "custom"}
                value={state.customDraft}
                onChange={(e) => setState((prev) => ({ ...prev, customDraft: e.target.value }))}
                onPressEnter={() => void handleSave()}
                className="app-claude-config-dir-panel__custom-input"
              />
            </div>
          </Radio>
        </Space>
      </Radio.Group>

      <Alert
        type="info"
        showIcon
        className="app-claude-config-dir-panel__hint"
        message="影响范围"
        description={
          <ul className="app-claude-config-dir-panel__hint-list">
            <li>
              <Typography.Text code>settings.json</Typography.Text>（默认模型、Hooks）、
              <Typography.Text code>agents/</Typography.Text>、<Typography.Text code>skills/</Typography.Text>。
            </li>
            <li>
              <Typography.Text code>plugins/cache</Typography.Text>、
              <Typography.Text code>plugins/marketplaces</Typography.Text>、
              <Typography.Text code>plugins/installed_plugins.json</Typography.Text> 与各插件包内的 MCP 声明。
            </li>
            <li>
              <Typography.Text code>projects/</Typography.Text> 下的会话 JSONL 与 Claude Code 用量统计。
            </li>
            <li>
              同步切换 <Typography.Text code>&lt;dir&gt;.json</Typography.Text>（默认 <Typography.Text code>~/.claude.json</Typography.Text>，自定义目录时为 <Typography.Text code>&lt;parent&gt;/&lt;dir-name&gt;.json</Typography.Text>）下的 user / projects MCP。
            </li>
          </ul>
        }
      />

      <Space size={8} className="app-claude-config-dir-panel__actions">
        <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void handleSave()}>
          保存
        </Button>
        <Button disabled={saving || info.isDefault} onClick={() => void handleReset()}>
          恢复默认
        </Button>
        <Button disabled={saving} onClick={() => void refresh()}>
          重新检测
        </Button>
      </Space>
    </div>
  );
}
