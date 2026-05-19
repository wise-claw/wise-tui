import { Tag, Typography } from "antd";
import type { ClaudeUserConfigDirInfo } from "../../services/claudeConfigDir";

interface Props {
  info: ClaudeUserConfigDirInfo;
}

export function ClaudeConfigDirCurrent({ info }: Props) {
  const modeLabel = info.isDefault ? "官方默认引擎环境" : "自定义引擎环境";
  return (
    <section className="app-claude-config-dir-panel__current" aria-label="当前引擎环境">
      <div className="app-claude-config-dir-panel__current-head">
        <div>
          <Typography.Text type="secondary" className="app-claude-config-dir-panel__eyebrow">
            当前引擎环境
          </Typography.Text>
          <Typography.Text strong className="app-claude-config-dir-panel__current-name">
            {modeLabel}
          </Typography.Text>
        </div>
        <div className="app-claude-config-dir-panel__current-tags">
          {info.isDefault ? <Tag color="default">默认</Tag> : <Tag color="processing">自定义</Tag>}
          {info.exists ? <Tag color="success">目录存在</Tag> : <Tag color="warning">待创建</Tag>}
        </div>
      </div>
      <Typography.Text code className="app-claude-config-dir-panel__current-path">
        {info.resolvedPath}
      </Typography.Text>
      {!info.isDefault ? (
        <Typography.Text type="secondary" className="app-claude-config-dir-panel__current-default">
          官方默认环境：<Typography.Text code>{info.defaultResolvedPath}</Typography.Text>
        </Typography.Text>
      ) : null}
    </section>
  );
}
