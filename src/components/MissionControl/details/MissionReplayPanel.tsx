import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Timeline, Typography } from "antd";
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  getMissionReplay,
  type MissionReplayEntry,
} from "../../../services/missionControlBackend";

interface MissionReplayPanelProps {
  missionId: string | null;
}


function eventIcon(eventType: string) {
  if (eventType.includes("failed") || eventType.includes("error")) {
    return <CloseCircleOutlined style={{ color: "var(--mission-error)" }} />;
  }
  if (eventType.includes("completed") || eventType.includes("succeeded")) {
    return <CheckCircleOutlined style={{ color: "var(--mission-success)" }} />;
  }
  if (eventType.includes("started") || eventType.includes("running")) {
    return <SyncOutlined spin style={{ color: "var(--mission-info)" }} />;
  }
  return <ClockCircleOutlined style={{ color: "var(--mission-dim)" }} />;
}

function getPayloadSessionId(entry: MissionReplayEntry): string | null {
  const sessionId = entry.payload.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

export function MissionReplayPanel({ missionId }: MissionReplayPanelProps) {
  const [entries, setEntries] = useState<MissionReplayEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!missionId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMissionReplay({ missionId })
      .then((list) => { if (!cancelled) setEntries(list); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [missionId]);

  if (!missionId) return null;

  return (
    <section className="mission-replay-panel">
      <div className="mission-replay-panel__header">
        <ThunderboltOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>Mission 事件时间线</Typography.Text>
        <Tag style={{ fontSize: 10 }}>{entries.length} 条</Tag>
      </div>
      {loading ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>
      ) : entries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件记录" />
      ) : (
        <div className="mission-replay-panel__timeline">
          <Timeline
            items={entries.slice(-30).reverse().map((entry) => ({
              dot: eventIcon(entry.entryType),
              children: (() => {
                const sessionId = getPayloadSessionId(entry);
                return (
                  <div className="mission-replay-entry">
                    <span className="mission-replay-entry__type">
                      {entry.title}
                    </span>
                    <span className="mission-replay-entry__time">
                      {new Date(entry.timestamp).toLocaleTimeString("zh-CN")}
                    </span>
                    {sessionId ? <Tag style={{ fontSize: 10 }}>session:{sessionId}</Tag> : null}
                    {entry.summary ? (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 11, display: "block" }}
                      >
                        {entry.summary}
                      </Typography.Text>
                    ) : null}
                  </div>
                );
              })(),
            }))}
          />
        </div>
      )}
    </section>
  );
}
