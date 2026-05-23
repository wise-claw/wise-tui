import { Popover, Tag } from "antd";
import { useMemo, useCallback, useEffect, useId, useState, type MouseEvent } from "react";
import "./ClaudeSessionTrajectoryDrawer.css";
import type { SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import { SequenceEventPopoverContent } from "./SequenceEventPopoverContent";
import { TRAJECTORY_LANE_IDS, sequenceEventActivityCategory, type TrajectoryLaneId } from "../../utils/claudeSessionTrajectorySequence";
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

function messageCardVariant(kind: SequenceEvent["kind"]): "user" | "assistant" | "default" {
  if (kind === "user_input") return "user";
  if (kind === "assistant_text") return "assistant";
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
  visibleStart: number;
  visibleEndExclusive: number;
  onVisibleRangeChange: (start: number, endExclusive: number) => void;
  onSubagentDrilldown?: (ev: SequenceEvent) => void;
  markInferredHttp?: boolean;
}

export function ClaudeSessionSequenceDiagram({
  events,
  visibleStart,
  visibleEndExclusive,
  onVisibleRangeChange,
  onSubagentDrilldown,
  markInferredHttp = false,
}: Props) {
  const lanes = TRAJECTORY_LANE_IDS;
  const rawGridId = useId();
  const [detailPopoverEventId, setDetailPopoverEventId] = useState<string | null>(null);

  const safeStart = Math.max(0, Math.min(visibleStart, Math.max(0, events.length - 1)));
  const safeEnd = Math.max(safeStart + 1, Math.min(visibleEndExclusive, events.length));
  const slice = events.slice(safeStart, safeEnd);

  useEffect(() => {
    setDetailPopoverEventId((id) => {
      if (!id) return id;
      return slice.some((e) => e.id === id) ? id : null;
    });
  }, [slice]);

  const onMinimapClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = rect.width > 0 ? x / rect.width : 0;
      const win = safeEnd - safeStart;
      const center = ratio * events.length;
      let ns = Math.floor(center - win / 2);
      ns = Math.max(0, Math.min(ns, Math.max(0, events.length - win)));
      onVisibleRangeChange(ns, Math.min(ns + win, events.length));
    },
    [events.length, onVisibleRangeChange, safeEnd, safeStart],
  );

  const minimapSegments = useMemo(() => {
    return events.map((ev) => ({
      cat: sequenceEventActivityCategory(ev),
      key: ev.id,
    }));
  }, [events]);

  const v0 = events.length > 0 ? safeStart / events.length : 0;
  const v1 = events.length > 0 ? safeEnd / events.length : 1;

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
          <span className="app-seq-diagram__legend-item app-seq-diagram__legend-item--model">模型接口</span>
          <span className="app-seq-diagram__legend-note">消息叠在泳道间 · 模型请求显示「接口」 · 点击卡片或接口查看全文</span>
        </div>

        <div
          className="app-seq-diagram__minimap"
          onClick={onMinimapClick}
          role="presentation"
          title="点击跳转时间区间"
        >
          {minimapSegments.map((s) => (
            <div
              key={s.key}
              className={`app-seq-diagram__minimap-seg app-seq-diagram__minimap-seg--${s.cat}`}
              style={{ flex: events.length > 0 ? 1 : 0 }}
            />
          ))}
          {events.length > 0 ? (
            <div className="app-seq-diagram__minimap-viewport" style={{ left: `${v0 * 100}%`, width: `${Math.max(0.02, v1 - v0) * 100}%` }} />
          ) : null}
        </div>

        <div className="app-seq-diagram__brush">
          <span className="app-seq-diagram__brush-label">区间</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, events.length - 1)}
            value={safeStart}
            onChange={(e) => {
              const ns = Number(e.target.value);
              const span = Math.max(1, safeEnd - safeStart);
              onVisibleRangeChange(ns, Math.min(ns + span, events.length));
            }}
            className="app-seq-diagram__brush-input"
          />
          <input
            type="range"
            min={1}
            max={events.length}
            value={safeEnd}
            onChange={(e) => {
              const ne = Number(e.target.value);
              if (ne <= safeStart) onVisibleRangeChange(Math.max(0, ne - 1), ne);
              else onVisibleRangeChange(safeStart, ne);
            }}
            className="app-seq-diagram__brush-input"
          />
          <span className="app-seq-diagram__brush-meta">
            {safeStart + 1}–{safeEnd} / {events.length}
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
          {slice.map((ev, i) => {
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
