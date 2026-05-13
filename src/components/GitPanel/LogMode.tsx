import { Empty, Spin, Tag, Typography } from "antd";
import type { GitLogEntry } from "../../types";
import { formatRelativeTime } from "./gitPanelUtils";

const { Text } = Typography;

interface LogModeProps {
  entries: GitLogEntry[];
  loading: boolean;
  ahead: number;
  behind: number;
  upstream: string | null;
}

export function LogMode({ entries, loading, ahead, behind, upstream }: LogModeProps) {
  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}><Spin size="small" description="加载中..." /></div>;
  }

  if (entries.length === 0) {
    return <Empty description="暂无提交记录" style={{ padding: "24px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="git-log-mode">
      {upstream && (ahead > 0 || behind > 0) && (
        <div className="git-log-sync-info">
          <div className="git-log-sync-stats">
            <Tag color="default" className="git-log-upstream-tag">
              {upstream}
            </Tag>
            {ahead > 0 && (
              <span className="git-log-stat git-log-stat--ahead">
                ↑{ahead}
              </span>
            )}
            {behind > 0 && (
              <span className="git-log-stat git-log-stat--behind">
                ↓{behind}
              </span>
            )}
          </div>
        </div>
      )}

      {ahead > 0 && entries.length > 0 && (
        <div className="git-log-section">
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>待推送</Text>
          <div className="git-log-list">
            {entries.slice(0, ahead).map((entry) => (
              <LogEntry key={entry.sha} entry={entry} />
            ))}
          </div>
        </div>
      )}

      <div className="git-log-section">
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>最近提交</Text>
        <div className="git-log-list">
          {entries.map((entry) => (
            <LogEntry key={entry.sha} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ entry }: { entry: GitLogEntry }) {
  return (
    <div className="git-log-entry">
      <div className="git-log-summary">{entry.summary || "无描述"}</div>
      <div className="git-log-meta">
        <Tag
          color="blue"
          style={{
            fontSize: 9,
            padding: "0 3px",
            lineHeight: "14px",
            borderRadius: 2,
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          }}
        >
          {entry.sha.slice(0, 7)}
        </Tag>
        <Text type="secondary" style={{ fontSize: 10 }}>{entry.author || "未知"}</Text>
        <Text type="secondary" style={{ fontSize: 10 }}>{formatRelativeTime(entry.timestamp)}</Text>
      </div>
    </div>
  );
}
