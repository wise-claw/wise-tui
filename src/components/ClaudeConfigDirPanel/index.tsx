import { Alert, Typography, message } from "antd";
import { useCallback } from "react";
import { ClaudeConfigDirActions } from "./ClaudeConfigDirActions";
import { ClaudeConfigDirChoiceList } from "./ClaudeConfigDirChoiceList";
import { ClaudeConfigDirCurrent } from "./ClaudeConfigDirCurrent";
import { useClaudeConfigDir } from "./useClaudeConfigDir";
import { useClaudeConfigDirChoice } from "./useClaudeConfigDirChoice";
import { SENTINEL_INVALID } from "./types";
import "./index.css";

export function ClaudeConfigDirPanel() {
  const { info, loading, saving, refresh, save, reset } = useClaudeConfigDir();
  const choice = useClaudeConfigDirChoice(info);

  const handleSave = useCallback(async () => {
    const value = choice.resolveValueToSave();
    if (value === SENTINEL_INVALID) {
      message.warning("请填写自定义路径，或选择上方预设。");
      return;
    }
    const next = await save(value);
    if (next) choice.syncToInfo(next);
  }, [choice, save]);

  const handleReset = useCallback(async () => {
    await reset();
  }, [reset]);

  if (loading && !info) {
    return <div className="app-claude-config-dir-panel">加载中…</div>;
  }
  if (!info) {
    return <div className="app-claude-config-dir-panel">无法读取当前配置，请重试。</div>;
  }

  return (
    <div className="app-claude-config-dir-panel">
      <ClaudeConfigDirCurrent info={info} />

      <ClaudeConfigDirChoiceList
        state={choice.state}
        onChoiceChange={choice.setChoice}
        onCustomDraftChange={choice.setCustomDraft}
        onSubmit={handleSave}
      />

      <Alert
        showIcon
        className="app-claude-config-dir-panel__hint"
        title="影响范围"
        description={
          <ul className="app-claude-config-dir-panel__hint-list">
            <li>
              同步切换 <Typography.Text code>&lt;dir&gt;.json</Typography.Text>：默认{" "}
              <Typography.Text code>~/.claude.json</Typography.Text>，自定义目录时为{" "}
              <Typography.Text code>&lt;parent&gt;/&lt;dir-name&gt;.json</Typography.Text> 下的 user / projects MCP。
            </li>
            <li>仓库内的项目级配置不跟随这里移动，避免影响已有项目契约。</li>
          </ul>
        }
      />

      <ClaudeConfigDirActions
        saving={saving}
        dirty={choice.dirty}
        canReset={!info.isDefault}
        onSave={handleSave}
        onReset={handleReset}
        onRefresh={refresh}
      />
    </div>
  );
}
