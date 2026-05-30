import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Typography } from "antd";
import {
  ThunderboltOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  BranchesOutlined,
  FileTextOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  listTrellisRuntimeEvents,
  type TrellisRuntimeEvent,
} from "../../../services/trellisRuntime";
import { readVisiblePollIntervalMs } from "../../../utils/adaptivePoll";

interface RuntimeEventFeedProps {
  rootPath?: string | null;
  projectId?: string | null;
  limit?: number;
  /** 父级已拉取事件时跳过内部轮询，避免与 `useTrellisRuntime` 重复 ingest */
  events?: readonly TrellisRuntimeEvent[] | null;
  loading?: boolean;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  hook: <ThunderboltOutlined />,
  task: <PlayCircleOutlined />,
  agent: <BranchesOutlined />,
  spec: <FileTextOutlined />,
  workflow: <SettingOutlined />,
  _default: <CodeOutlined />,
};

function kindIcon(kind: string) {
  if (kind === "trellis.agent.stale") return <WarningOutlined />;
  for (const [key, icon] of Object.entries(KIND_ICON)) {
    if (kind.includes(key)) return icon;
  }
  return KIND_ICON._default;
}

function kindLabel(kind: string): string {
  if (kind.includes("hook")) return "Hook";
  if (kind.includes("task.create")) return "创建任务";
  if (kind.includes("task.start")) return "开始任务";
  if (kind.includes("task.complete")) return "完成任务";
  if (kind.includes("agent.start")) return "Agent 启动";
  if (kind.includes("agent.complete")) return "Agent 完成";
  if (kind.includes("agent.stale")) return "Agent 断连";
  if (kind.includes("agent.heartbeat")) return "Agent 心跳";
  if (kind.includes("spec")) return "Spec 变更";
  if (kind.includes("workflow")) return "Workflow";
  return kind.replace("trellis.", "").replace("runtime.", "");
}

export function RuntimeEventFeed({
  rootPath,
  projectId,
  limit = 30,
  events: externalEvents,
  loading: externalLoading,
}: RuntimeEventFeedProps) {
  const [events, setEvents] = useState<TrellisRuntimeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const useExternal = externalEvents != null;

  useEffect(() => {
    if (useExternal || !rootPath) {
      if (!useExternal) setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const fetch = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      listTrellisRuntimeEvents({ projectId, rootPath, limit })
        .then((list) => {
          if (!cancelled) setEvents(list);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    fetch();
    const timer = setInterval(fetch, readVisiblePollIntervalMs(6000, 24000));
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetch();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [rootPath, projectId, limit, useExternal]);

  if (!rootPath) return null;

  const displayEvents = useExternal ? [...externalEvents] : events;
  const displayLoading = useExternal ? (externalLoading ?? false) : loading;

  return (
    <section className="runtime-feed">
      <div className="runtime-feed__header">
        <ThunderboltOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>Runtime 事件</Typography.Text>
        <Tag style={{ fontSize: 10 }}>{displayEvents.length}</Tag>
      </div>
      <div className="runtime-feed__scroll">
        {displayLoading && displayEvents.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>
        ) : displayEvents.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行时事件" />
        ) : (
          <div className="runtime-feed__list">
            {displayEvents.map((ev) => (
              <div
                key={ev.eventId}
                className={`runtime-event ${ev.eventKind === "trellis.agent.stale" ? "runtime-event--stale" : ""}`}
              >
                <span className="runtime-event__icon">{kindIcon(ev.eventKind)}</span>
                <div className="runtime-event__body">
                  <div className="runtime-event__head">
                    <span className="runtime-event__kind">{kindLabel(ev.eventKind)}</span>
                    <span className="runtime-event__time">
                      {new Date(ev.createdAt).toLocaleTimeString("zh-CN")}
                    </span>
                  </div>
                  {ev.taskPath ? (
                    <span className="runtime-event__task">{ev.taskPath.split("/").pop()}</span>
                  ) : null}
                  {ev.actor ? (
                    <Tag style={{ fontSize: 9, lineHeight: "14px", margin: "2px 0 0" }}>
                      {ev.actor}
                    </Tag>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
