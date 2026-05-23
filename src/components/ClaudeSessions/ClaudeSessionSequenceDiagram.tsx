import { Popover, Tag } from "antd";
import { useEffect, useState } from "react";
import "./ClaudeSessionTrajectoryDrawer.css";
import type { SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import { SequenceEventPopoverContent } from "./SequenceEventPopoverContent";
import { TRAJECTORY_LANE_IDS, type TrajectoryLaneId } from "../../utils/claudeSessionTrajectorySequence";
import { formatChatMessageListTime } from "../../utils/formatChatMessageListTime";

const LANE_LABELS: Record<TrajectoryLaneId, string> = {
  user: "我",
  claude_code: "CC",
  model: "模型",
};

const LANE_SUB_LABELS: Record<TrajectoryLaneId, string> = {
  user: "我",
  claude_code: "Claude Code",
  model: "模型",
};

function messageBodyForCard(ev: SequenceEvent): string {
  const sub = (ev.subtitle ?? "").replace(/\s+/g, " ").trim();
  if (sub) return sub;
  const detail = (ev.detail ?? "").replace(/\s+/g, " ").trim();
  if (detail) return detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
  return ev.label;
}

function messageCardVariant(
  kind: SequenceEvent["kind"],
): "user" | "assistant" | "hook" | "skill" | "mcp" | "subagent" | "default" {
  if (kind === "user_input") return "user";
  if (kind === "assistant_text") return "assistant";
  if (kind === "hook" || kind === "skill" || kind === "mcp" || kind === "subagent") return kind;
  return "default";
}

function SeqMessageCard({
  kind,
  label,
  body,
}: {
  kind: SequenceEvent["kind"];
  label: string;
  body: string;
}) {
  const variant = messageCardVariant(kind);
  return (
    <div className={`app-seq-msg-card app-seq-msg-card--${variant}`} data-kind={kind}>
      <span className="app-seq-msg-card__badge">{label}</span>
      <div className="app-seq-msg-card__body">{body || "—"}</div>
    </div>
  );
}

function SeqInterfaceBox({ inferred }: { inferred?: boolean }) {
  return (
    <div className={`app-seq-iface-box ${inferred ? "app-seq-iface-box--inferred" : ""}`}>
      接口
    </div>
  );
}

interface LaneSpanInfo {
  gridColumn: string;
  arrowDir: "right" | "left" | "double" | "self-loop-user" | "self-loop-cc" | "self-loop-model";
}

function getLaneSpan(ev: SequenceEvent): LaneSpanInfo {
  const from = ev.fromLane;
  const to = ev.toLane;

  if (
    ev.kind === "hook" ||
    ev.kind === "skill" ||
    ev.kind === "mcp" ||
    ev.kind === "subagent" ||
    (from === "claude_code" && to === "claude_code")
  ) {
    return {
      gridColumn: "3 / 4",
      arrowDir: "self-loop-cc",
    };
  }

  if (ev.kind === "api_request") {
    return {
      gridColumn: "3 / 4",
      arrowDir: "double",
    };
  }

  if (from === "user" && to === "claude_code") {
    return {
      gridColumn: "2 / 3",
      arrowDir: "right",
    };
  }
  if (from === "claude_code" && to === "user") {
    return {
      gridColumn: "2 / 3",
      arrowDir: "left",
    };
  }
  if (from === "claude_code" && to === "model") {
    return {
      gridColumn: "3 / 4",
      arrowDir: "right",
    };
  }
  if (from === "model" && to === "claude_code") {
    return {
      gridColumn: "3 / 4",
      arrowDir: "left",
    };
  }
  if (from === "user" && to === "model") {
    return {
      gridColumn: "2 / 4",
      arrowDir: "right",
    };
  }
  if (from === "model" && to === "user") {
    return {
      gridColumn: "2 / 4",
      arrowDir: "left",
    };
  }

  // Self-loops
  if (from === "user") {
    return {
      gridColumn: "2 / 3",
      arrowDir: "self-loop-user",
    };
  }
  if (from === "claude_code") {
    return {
      gridColumn: "3 / 4",
      arrowDir: "self-loop-cc",
    };
  }
  return {
    gridColumn: "3 / 4",
    arrowDir: "self-loop-model",
  };
}

interface Props {
  events: SequenceEvent[];
  onSubagentDrilldown?: (ev: SequenceEvent) => void;
  markInferredHttp?: boolean;
}

export function ClaudeSessionSequenceDiagram({
  events,
  onSubagentDrilldown,
  markInferredHttp = false,
}: Props) {
  const lanes = TRAJECTORY_LANE_IDS;
  const [detailPopoverEventId, setDetailPopoverEventId] = useState<string | null>(null);

  useEffect(() => {
    setDetailPopoverEventId((id) => {
      if (!id) return id;
      return events.some((e) => e.id === id) ? id : null;
    });
  }, [events]);

  return (
    <div className="app-seq-diagram">
      <div className="app-seq-diagram__toolbar">
        <div className="app-seq-diagram__legend">
          <span className="app-seq-diagram__legend-title">三泳道序列</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--thinking">思考</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--command">命令</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--file">读写文件</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--hook">Hooks</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--skill">Skills</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--mcp">MCP</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--subagent">Subagent</span>
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--model">模型接口</span>
          <span className="app-seq-diagram__legend-note">
            CC 泳道自环：Skills / MCP / Subagent / Hooks · 模型请求为「接口」 · 点击卡片查看详情
          </span>
        </div>
      </div>

      <div className="app-seq-diagram__header">
        <div className="app-seq-diagram__header-time-spacer" aria-hidden />
        <div className="app-seq-diagram__header-canvas">
          {lanes.map((lane) => (
            <div
              key={lane}
              className={`app-seq-diagram__lane-head app-seq-diagram__lane-head--${lane}`}
            >
              <div className="app-seq-diagram__lane-title">
                {lane === "model" ? "◆ " : ""}
                {LANE_LABELS[lane]}
              </div>
              <div className="app-seq-diagram__lane-subtitle">{LANE_SUB_LABELS[lane]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="app-seq-flow">
        <div className="app-seq-flow__timeline-container">
          {events.map((ev, i) => {
            const isApiRequest = ev.kind === "api_request";

            const cardBodyRaw = messageBodyForCard(ev);
            const badgeLabel = ev.flags.loopDense ? "LOOP" : ev.label;
            const isInferredHttpStep = markInferredHttp && isApiRequest && !ev.flags.observedHttp;
            const spanInfo = getLaneSpan(ev);

            return (
              <div
                key={ev.id}
                data-kind={ev.kind}
                className={`app-seq-row ${i % 2 === 1 ? "app-seq-row--alt" : ""} ${ev.flags.key ? "app-seq-row--key" : ""} ${ev.drilldown ? "app-seq-row--drill" : ""}`}
              >
                <div className="app-seq-row__time-col">
                  <span className="app-seq-row__time-text">{formatChatMessageListTime(ev.timestamp)}</span>
                  <div className="app-seq-row__time-tags">
                    {ev.flags.retry ? <Tag className="app-seq-row__tag">重试</Tag> : null}
                    {ev.flags.loopDense ? <Tag className="app-seq-row__tag">密</Tag> : null}
                    {ev.flags.longGap ? <Tag className="app-seq-row__tag">慢</Tag> : null}
                  </div>
                </div>

                <div className="app-seq-row__canvas">
                  <div className="app-seq-row__lifelines-bg" aria-hidden="true">
                    <div className="app-seq-row__lifeline-vertical app-seq-row__lifeline-vertical--user" />
                    <div className="app-seq-row__lifeline-vertical app-seq-row__lifeline-vertical--cc" />
                    <div className="app-seq-row__lifeline-vertical app-seq-row__lifeline-vertical--model" />
                  </div>

                  {ev.kind === "thinking" && (
                    <div className="app-seq-row__thinking-overlay" />
                  )}

                  <div className="app-seq-row__grid-content">
                    <div className="app-seq-row__grid-item" style={{ gridColumn: spanInfo.gridColumn }}>
                      {spanInfo.arrowDir === "double" ? (
                        <Popover
                          open={detailPopoverEventId === ev.id}
                          onOpenChange={(next) => setDetailPopoverEventId(next ? ev.id : null)}
                          trigger="click"
                          placement="bottom"
                          destroyOnHidden
                          rootClassName="app-seq-event-popover-root"
                          content={<SequenceEventPopoverContent ev={ev} />}
                        >
                          <button
                            type="button"
                            className="app-seq-row__double-arrow-wrapper"
                            aria-label="查看接口详情"
                          >
                            <div className={`app-seq-row__arrow-line app-seq-row__arrow-line--right ${isInferredHttpStep ? "app-seq-row__arrow-line--inferred" : ""}`} />
                            <SeqInterfaceBox inferred={isInferredHttpStep} />
                            <div className={`app-seq-row__arrow-line app-seq-row__arrow-line--left ${isInferredHttpStep ? "app-seq-row__arrow-line--inferred" : ""}`} />
                          </button>
                        </Popover>
                      ) : spanInfo.arrowDir.startsWith("self-loop") ? (
                        <Popover
                          open={detailPopoverEventId === ev.id}
                          onOpenChange={(next) => setDetailPopoverEventId(next ? ev.id : null)}
                          trigger="click"
                          placement="bottom"
                          destroyOnHidden
                          rootClassName="app-seq-event-popover-root"
                          content={
                            <SequenceEventPopoverContent
                              ev={ev}
                              onSubagentDrilldown={
                                onSubagentDrilldown
                                  ? (target) => {
                                      onSubagentDrilldown(target);
                                      setDetailPopoverEventId(null);
                                    }
                                  : undefined
                              }
                            />
                          }
                        >
                          <button
                            type="button"
                            className={`app-seq-row__self-loop-wrapper app-seq-row__self-loop-wrapper--${spanInfo.arrowDir}`}
                            aria-label={`查看 ${ev.label} 详情`}
                          >
                            <div className={`app-seq-row__self-loop-curve app-seq-row__self-loop-curve--${spanInfo.arrowDir}`} />
                            <SeqMessageCard kind={ev.kind} label={badgeLabel} body={cardBodyRaw} />
                          </button>
                        </Popover>
                      ) : (
                        <Popover
                          open={detailPopoverEventId === ev.id}
                          onOpenChange={(next) => setDetailPopoverEventId(next ? ev.id : null)}
                          trigger="click"
                          placement="bottom"
                          destroyOnHidden
                          rootClassName="app-seq-event-popover-root"
                          content={
                            <SequenceEventPopoverContent
                              ev={ev}
                              onSubagentDrilldown={
                                onSubagentDrilldown
                                  ? (target) => {
                                      onSubagentDrilldown(target);
                                      setDetailPopoverEventId(null);
                                    }
                                  : undefined
                              }
                            />
                          }
                        >
                          <button
                            type="button"
                            className="app-seq-row__single-arrow-wrapper"
                            aria-label={`查看 ${ev.label} 详情`}
                          >
                            <div className={`app-seq-row__arrow-line app-seq-row__arrow-line--${spanInfo.arrowDir}`} />
                            <div className="app-seq-row__card-container">
                              <SeqMessageCard kind={ev.kind} label={badgeLabel} body={cardBodyRaw} />
                            </div>
                          </button>
                        </Popover>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
