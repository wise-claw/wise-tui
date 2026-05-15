import { Button, Popover, Tag } from "antd";
import { useMemo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import { TRAJECTORY_LANE_IDS, sequenceEventActivityCategory, type TrajectoryLaneId } from "../../utils/claudeSessionTrajectorySequence";
import { formatChatMessageListTime } from "../../utils/formatChatMessageListTime";

/** 每行在 viewBox 中的高度（用户单位）；略大以撑开行距、给箭头上方消息卡留高 */
const ROW_H = 15;
const VB_W = 100;

const LANE_LABELS: Record<TrajectoryLaneId, string> = {
  user: "我",
  claude_code: "Claude Code",
  model: "模型",
};

/** 按可用宽度截断正文（中文按全角、英文按半角估算） */
function excerptInlineForWidth(s: string, innerW: number, fontSize: number, maxCap: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const isWide = (ch: string) => /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
  let used = 0;
  let out = "";
  for (const ch of t) {
    if (out.length >= maxCap) break;
    const w = (isWide(ch) ? 1 : 0.55) * fontSize;
    if (used + w > innerW && out.length > 0) {
      return `${out}…`;
    }
    used += w;
    out += ch;
  }
  return out.length < t.length ? `${out}…` : out;
}

/** 估算 SVG 文本宽度（viewBox 用户单位）；大写徽章略放宽系数 */
function estimateSvgTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

/**
 * 泳道生命线水平位置（viewBox 0–100）。
 * CC 泳道洗色宽度 = (model − user) / 2；左右对称微调生命线以收放中带。
 */
const LANE_CENTER_X: Record<TrajectoryLaneId, number> = {
  user: 15.35,
  claude_code: 50,
  model: 84.65,
};

function laneWashBounds(): { user: { x: number; w: number }; claude_code: { x: number; w: number }; model: { x: number; w: number } } {
  const u = LANE_CENTER_X.user;
  const c = LANE_CENTER_X.claude_code;
  const m = LANE_CENTER_X.model;
  const midUC = (u + c) / 2;
  const midCM = (c + m) / 2;
  return {
    user: { x: 0, w: midUC },
    claude_code: { x: midUC, w: midCM - midUC },
    model: { x: midCM, w: VB_W - midCM },
  };
}

function swimLaneDividerXs(): { userCc: number; ccModel: number } {
  return {
    userCc: (LANE_CENTER_X.user + LANE_CENTER_X.claude_code) / 2,
    ccModel: (LANE_CENTER_X.claude_code + LANE_CENTER_X.model) / 2,
  };
}

function laneCenterX(lane: TrajectoryLaneId): number {
  return LANE_CENTER_X[lane] ?? 50;
}

interface Props {
  events: SequenceEvent[];
  visibleStart: number;
  visibleEndExclusive: number;
  onVisibleRangeChange: (start: number, endExclusive: number) => void;
  onSubagentDrilldown?: (ev: SequenceEvent) => void;
}

export function ClaudeSessionSequenceDiagram({
  events,
  visibleStart,
  visibleEndExclusive,
  onVisibleRangeChange,
  onSubagentDrilldown,
}: Props) {
  const lanes = TRAJECTORY_LANE_IDS;
  const rawGridId = useId();
  const gridPatternId = `appSeqFlowGrid-${rawGridId.replace(/[^a-zA-Z0-9_-]+/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgCssWidth, setSvgCssWidth] = useState(0);
  const [detailPopoverEventId, setDetailPopoverEventId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const el = svg.parentElement ?? svg;
    const measure = () => {
      setSvgCssWidth(svg.getBoundingClientRect().width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const safeStart = Math.max(0, Math.min(visibleStart, Math.max(0, events.length - 1)));
  const safeEnd = Math.max(safeStart + 1, Math.min(visibleEndExclusive, events.length));
  const slice = events.slice(safeStart, safeEnd);

  useEffect(() => {
    setDetailPopoverEventId((id) => {
      if (!id) return id;
      return slice.some((e) => e.id === id) ? id : null;
    });
  }, [slice]);

  const totalH = Math.max(ROW_H, slice.length * ROW_H);

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

  const wash = laneWashBounds();
  const dividerX = swimLaneDividerXs();
  const rowHeightPx = Math.round(
    Math.max(46, Math.min(100, svgCssWidth > 0 ? (ROW_H * svgCssWidth) / VB_W : 68)),
  );

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
          <span className="app-seq-diagram__legend-note">摘要在箭头上方 · 点击行查看全文</span>
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
        {lanes.map((lane) => (
          <div key={lane} className={`app-seq-diagram__lane-head app-seq-diagram__lane-head--${lane}`}>
            <div className="app-seq-diagram__lane-icon" aria-hidden>
              {lane === "user" ? "我" : lane === "claude_code" ? "CC" : "◆"}
            </div>
            <div className="app-seq-diagram__lane-title">{LANE_LABELS[lane]}</div>
          </div>
        ))}
      </div>

      <div className="app-seq-flow">
        <div className="app-seq-flow__time-col">
          {slice.map((ev) => (
            <div key={`t-${ev.id}`} className="app-seq-flow__time-cell" style={{ height: rowHeightPx }}>
              <span className="app-seq-flow__time-text">{formatChatMessageListTime(ev.timestamp)}</span>
              <div className="app-seq-flow__time-tags">
                {ev.flags.retry ? <Tag className="app-seq-flow__tag">重试</Tag> : null}
                {ev.flags.loopDense ? <Tag className="app-seq-flow__tag">密</Tag> : null}
                {ev.flags.longGap ? <Tag className="app-seq-flow__tag">慢</Tag> : null}
              </div>
            </div>
          ))}
        </div>

        <div className="app-seq-flow__svg-scroll">
          <svg
            ref={svgRef}
            className="app-seq-flow__svg"
            viewBox={`0 0 ${VB_W} ${totalH}`}
            preserveAspectRatio="xMidYMin meet"
            width="100%"
          >
            <defs>
              <pattern id={gridPatternId} width="10" height="10" patternUnits="userSpaceOnUse">
                <path
                  d="M 10 0 L 0 0 0 10"
                  fill="none"
                  className="app-seq-flow__grid-pattern-stroke"
                  vectorEffect="non-scaling-stroke"
                />
              </pattern>
            </defs>
            <rect
              x={0}
              y={0}
              width={VB_W}
              height={totalH}
              fill={`url(#${gridPatternId})`}
              className="app-seq-flow__grid-layer"
              pointerEvents="none"
            />
            <rect x={wash.user.x} y={0} width={wash.user.w} height={totalH} className="app-seq-flow__lane-wash app-seq-flow__lane-wash--user" pointerEvents="none" />
            <rect
              x={wash.claude_code.x}
              y={0}
              width={wash.claude_code.w}
              height={totalH}
              className="app-seq-flow__lane-wash app-seq-flow__lane-wash--claude_code"
              pointerEvents="none"
            />
            <rect x={wash.model.x} y={0} width={wash.model.w} height={totalH} className="app-seq-flow__lane-wash app-seq-flow__lane-wash--model" pointerEvents="none" />
            <g className="app-seq-flow__rails" pointerEvents="none" aria-hidden>
              <line
                x1={dividerX.userCc}
                y1={0}
                x2={dividerX.userCc}
                y2={totalH}
                className="app-seq-flow__lane-divider"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={dividerX.ccModel}
                y1={0}
                x2={dividerX.ccModel}
                y2={totalH}
                className="app-seq-flow__lane-divider"
                vectorEffect="non-scaling-stroke"
              />
              {lanes.map((lane) => {
                const x = laneCenterX(lane);
                return (
                  <line
                    key={`rail-${lane}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={totalH}
                    className={`app-seq-flow__lifeline app-seq-flow__lifeline--${lane}`}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
            {slice.map((ev, i) => {
              const x1 = laneCenterX(ev.fromLane);
              const x2 = laneCenterX(ev.toLane);
              const rowTop = i * ROW_H;
              const yLine = rowTop + ROW_H * 0.82;
              const selfLoop = ev.fromLane === ev.toLane;
              const popoverBodyRaw = [ev.subtitle, ev.detail, ev.rawJsonlLine].filter(Boolean).join("\n\n\n").trim();
              const popoverBodyText =
                popoverBodyRaw.length > 12000 ? `${popoverBodyRaw.slice(0, 12000)}…` : popoverBodyRaw || "—";
              const mx = (x1 + x2) / 2;
              const subRaw = (ev.subtitle ?? "").replace(/\s+/g, " ").trim();
              const cardBodyCap = ev.flags.loopDense ? 30 : 40;
              const cardBodyRaw =
                `${subRaw}${ev.drilldown ? " · 下钻" : ""}`.replace(/\s+/g, " ").trim() || ev.label;
              const ccOnly = ev.fromLane === "claude_code" && ev.toLane === "claude_code";
              const ccL = wash.claude_code.x;
              const ccWb = wash.claude_code.w;
              const ccR = ccL + ccWb;

              const userLaneW = wash.user.w;
              const modelLaneW = wash.model.w;
              const userOnly = ev.fromLane === "user" && ev.toLane === "user";
              const modelOnly = ev.fromLane === "model" && ev.toLane === "model";
              const userEdge = ev.fromLane === "user" || ev.toLane === "user";
              const modelEdge = ev.fromLane === "model" || ev.toLane === "model";

              const spanX = Math.abs(x2 - x1);
              let cardW = Math.min(27, Math.max(11.5, spanX + 3.2));
              let cardCenterX = mx;
              if (ccOnly) {
                cardW = Math.min(24, Math.max(10, ccWb - 1.4));
                cardCenterX = LANE_CENTER_X.claude_code;
              } else if (userOnly) {
                cardW = userLaneW - 1.2;
                cardCenterX = LANE_CENTER_X.user;
              } else if (modelOnly) {
                cardW = modelLaneW - 1.2;
                cardCenterX = LANE_CENTER_X.model;
              } else if (userEdge && !modelEdge) {
                cardW = Math.min(userLaneW + ccWb * 0.42, Math.max(spanX + 5.5, userLaneW - 0.8));
              } else if (modelEdge && !userEdge) {
                cardW = Math.min(modelLaneW + ccWb * 0.42, Math.max(spanX + 5.5, modelLaneW - 0.8));
              }
              cardW = Math.min(cardW, VB_W - 0.8);
              const cardH = ROW_H * 0.43;
              const cardX = Math.max(0.35, Math.min(cardCenterX - cardW / 2, VB_W - cardW - 0.35));
              const cardY = rowTop + ROW_H * 0.105;
              const fsBadge = ROW_H * 0.098;
              const fsBody = ROW_H * 0.11;
              const padX = ROW_H * 0.08;
              const padY = ROW_H * 0.03;
              const cardRx = ROW_H * 0.07;
              const badgePadX = ROW_H * 0.055;
              const badgePadY = ROW_H * 0.02;
              const badgeLabel = ev.flags.loopDense ? "LOOP" : ev.label;
              const badgeTextW = estimateSvgTextWidth(badgeLabel, fsBadge) * 1.06;
              const badgeW = Math.min(
                cardW - padX * 2,
                Math.max(badgeTextW + badgePadX * 2, fsBadge * 3.4),
              );
              const badgeH = fsBadge + badgePadY * 2;
              const bodyInnerW = Math.max(2, cardW - padX * 2);
              const cardBodyDisplay = excerptInlineForWidth(
                cardBodyRaw,
                bodyInnerW,
                fsBody,
                Math.min(cardBodyCap, Math.max(8, Math.floor(bodyInnerW / (fsBody * 0.55)))),
              );
              const cardClipId = `${gridPatternId}-card-${i}`;
              const textX = cardX + padX;
              const badgeY = cardY + padY;
              const badgeTextY = badgeY + badgePadY + fsBadge * 0.84;
              const bodyTextY = badgeY + badgeH + ROW_H * 0.045 + fsBody * 0.88;

              const arrowLineClass = ["app-seq-flow__arrow", ev.flags.loopDense ? "app-seq-flow__arrow--loop-dense" : ""]
                .filter(Boolean)
                .join(" ");
              const arrowHeadClass = ["app-seq-flow__arrowhead", ev.flags.loopDense ? "app-seq-flow__arrowhead--loop-dense" : ""]
                .filter(Boolean)
                .join(" ");

              const yBandT = ROW_H * 0.1;
              const ah = ROW_H * 0.16;
              const av = ROW_H * 0.07;

              return (
                <g
                  key={ev.id}
                  data-kind={ev.kind}
                  className={[
                    "app-seq-flow__step",
                    i % 2 === 1 ? "app-seq-flow__step--alt" : "",
                    ev.flags.key ? "app-seq-flow__step--key" : "",
                    ev.drilldown ? "app-seq-flow__step--drill" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                    {i % 2 === 1 ? (
                      <rect
                        x={0}
                        y={i * ROW_H}
                        width={VB_W}
                        height={ROW_H}
                        className="app-seq-flow__row-stripe"
                        pointerEvents="none"
                      />
                    ) : null}
                    {ev.kind === "thinking" ? (
                      ccOnly ? (
                        <rect
                          x={wash.claude_code.x + 0.6}
                          y={i * ROW_H + yBandT}
                          width={wash.claude_code.w - 1.2}
                          height={ROW_H - 2 * yBandT}
                          rx={5}
                          className="app-seq-flow__thinking-band"
                          pointerEvents="none"
                        />
                      ) : (
                        <rect
                          x={1.5}
                        y={i * ROW_H + yBandT}
                        width={VB_W - 3}
                        height={ROW_H - 2 * yBandT}
                          rx={5}
                          className="app-seq-flow__thinking-band"
                          pointerEvents="none"
                        />
                      )
                    ) : null}
                    {ev.flags.key ? (
                      <rect
                        x={0}
                        y={i * ROW_H}
                        width={VB_W}
                        height={ROW_H}
                        className="app-seq-flow__row-keybg"
                        pointerEvents="none"
                      />
                    ) : null}
                    {selfLoop ? (
                      ccOnly ? (
                        <path
                          d={(() => {
                            const xl = ccL + 2.2;
                            const xr = ccR - 2.2;
                            const yLow = rowTop + ROW_H * 0.82;
                            const yCtl = rowTop + ROW_H * 0.98;
                            return `M ${xl} ${yLow} Q ${LANE_CENTER_X.claude_code} ${yCtl} ${xr} ${yLow}`;
                          })()}
                          className={arrowLineClass}
                          fill="none"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (
                        <path
                          d={`M ${x1 - 0.24} ${yLine + ROW_H * 0.08} Q ${x1} ${yLine + ROW_H * 0.22} ${x1 + 0.24} ${yLine + ROW_H * 0.08}`}
                          className={arrowLineClass}
                          fill="none"
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                    ) : (
                      <>
                        <line x1={x1} y1={yLine} x2={x2} y2={yLine} className={arrowLineClass} vectorEffect="non-scaling-stroke" />
                        <polygon
                          points={`${x2},${yLine} ${x2 - (x2 >= x1 ? ah : -ah)},${yLine - av} ${x2 - (x2 >= x1 ? ah : -ah)},${yLine + av}`}
                          className={arrowHeadClass}
                          vectorEffect="non-scaling-stroke"
                        />
                      </>
                    )}
                    <defs>
                      <clipPath id={cardClipId}>
                        <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={cardRx} />
                      </clipPath>
                    </defs>
                    <g className="app-seq-flow__inline-card" pointerEvents="none" clipPath={`url(#${cardClipId})`}>
                      <rect
                        x={cardX}
                        y={cardY}
                        width={cardW}
                        height={cardH}
                        rx={cardRx}
                        className="app-seq-flow__inline-card__bg"
                      />
                      <rect
                        x={textX}
                        y={badgeY}
                        width={badgeW}
                        height={badgeH}
                        rx={ROW_H * 0.032}
                        className="app-seq-flow__inline-card__badge-bg"
                        data-kind={ev.kind}
                      />
                      <text
                        x={textX + badgePadX}
                        y={badgeTextY}
                        fontSize={fsBadge}
                        fontWeight={700}
                        className="app-seq-flow__inline-card__badge-text"
                        data-kind={ev.kind}
                      >
                        {badgeLabel}
                      </text>
                      <text
                        x={textX}
                        y={bodyTextY}
                        fontSize={fsBody}
                        fontWeight={500}
                        className={[
                          "app-seq-flow__inline-card__body-text",
                          ev.drilldown ? "app-seq-flow__inline-card__body-text--drill" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {cardBodyDisplay}
                      </text>
                    </g>
                    <foreignObject x={0} y={i * ROW_H} width={VB_W} height={ROW_H} className="app-seq-flow__hit-fo">
                      <div className="app-seq-flow__hit-fo-inner">
                        <Popover
                          open={detailPopoverEventId === ev.id}
                          onOpenChange={(next) => setDetailPopoverEventId(next ? ev.id : null)}
                          trigger="click"
                          placement="bottom"
                          destroyOnHidden
                          rootClassName="app-seq-event-popover-root"
                          content={
                            <div className="app-seq-event-popover-card">
                              <span className="app-seq-event-popover-card__badge" data-kind={ev.kind}>
                                {ev.label}
                              </span>
                              <div className="app-seq-event-popover-card__main">{popoverBodyText}</div>
                              {ev.drilldown && onSubagentDrilldown ? (
                                <Button
                                  type="link"
                                  size="small"
                                  className="app-seq-event-popover-card__drill"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    onSubagentDrilldown(ev);
                                    setDetailPopoverEventId(null);
                                  }}
                                >
                                  查看子代理任务
                                </Button>
                              ) : null}
                            </div>
                          }
                        >
                          <button
                            type="button"
                            className="app-seq-flow__row-hit"
                            aria-label={`查看「${ev.label}」详情`}
                            title=""
                          />
                        </Popover>
                      </div>
                    </foreignObject>
                  </g>
              );
            })}

          </svg>
        </div>
      </div>
    </div>
  );
}
