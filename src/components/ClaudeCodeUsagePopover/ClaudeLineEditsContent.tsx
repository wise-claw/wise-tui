import { Popover, Spin, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  ClaudeLineEditsDayBucket,
  ClaudeLineEditsSnapshotResponse,
} from "../../services/claudeCodeUsage";
import {
  buildLineEditsHeatmapWeeks,
  formatHeatmapDateLabel,
  formatLinesEdited,
  heatmapLevel,
  weekdayLabelForRow,
  WEEKDAY_LABEL_ROWS,
} from "../../utils/claudeLineEditsHeatmap";
import "./index.css";

/**
 * 顶部「新增 / 删除」对比条：label + 数值横排展示。
 * 不再渲染比例柱，避免视觉噪音；如需恢复比例可视化见 git history。
 */
function LineEditsSplitBars({
  added,
  removed,
}: {
  added: number;
  removed: number;
}) {
  return (
    <div className="app-cc-line-edits-split" aria-label="代码编辑量前后对比">
      <div className="app-cc-line-edits-split-stat app-cc-line-edits-split-stat--add">
        <div className="app-cc-line-edits-split-label">新增</div>
        <div className="app-cc-line-edits-split-value">+{formatLinesEdited(added)}</div>
      </div>
      <div className="app-cc-line-edits-split-stat app-cc-line-edits-split-stat--remove">
        <div className="app-cc-line-edits-split-label">删除</div>
        <div className="app-cc-line-edits-split-value">−{formatLinesEdited(removed)}</div>
      </div>
    </div>
  );
}

export interface ClaudeLineEditsContentProps {
  snapshot: ClaudeLineEditsSnapshotResponse | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
  onRefresh: () => void;
  /**
   * 弹窗刚打开时为 true：默认聚焦当天「合计行」展示今日行数；hover 任意 heatmap cell 切换到该日。
   * 关闭后下次打开再激活。
   */
  focusTodayOnOpen?: boolean;
}

function LineEditsCellPopoverContent({
  date,
  linesEdited,
  diffCount,
}: {
  date: string;
  linesEdited: number;
  diffCount: number;
}) {
  return (
    <div className="app-cc-line-edits-cell-popover">
      <div className="app-cc-line-edits-tooltip-date">{formatHeatmapDateLabel(date)}</div>
      <div className="app-cc-line-edits-tooltip-metric app-cc-line-edits-tooltip-metric--lines">
        {formatLinesEdited(linesEdited)} 行编辑
      </div>
      <div className="app-cc-line-edits-tooltip-metric app-cc-line-edits-tooltip-metric--diffs">
        {formatLinesEdited(diffCount)} 次编辑
      </div>
    </div>
  );
}

export function ClaudeLineEditsContent({
  snapshot,
  snapshotLoading,
  snapshotError,
  onRefresh,
  focusTodayOnOpen = false,
}: ClaudeLineEditsContentProps) {
  const { weeks, monthLabels } = useMemo(
    () => buildLineEditsHeatmapWeeks(snapshot?.days ?? []),
    [snapshot?.days],
  );

  // hover 任意 heatmap cell 时记录被聚焦的日期；首次进入且未 hover 则取 days[] 末项（即今天）。
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  useEffect(() => {
    setHoveredDate(null);
  }, [snapshot]);
  const focusedDay = useMemo<ClaudeLineEditsDayBucket | null>(() => {
    const days = snapshot?.days ?? [];
    if (days.length === 0) return null;
    if (hoveredDate) {
      const hit = days.find((d) => d.date === hoveredDate);
      if (hit) return hit;
    }
    if (focusTodayOnOpen) {
      return days[days.length - 1] ?? null;
    }
    return null;
  }, [snapshot?.days, hoveredDate, focusTodayOnOpen]);

  const maxLines = useMemo(() => {
    let m = 0;
    for (const day of snapshot?.days ?? []) {
      if (day.linesEdited > m) m = day.linesEdited;
    }
    return m > 0 ? m : 1;
  }, [snapshot?.days]);

  const totalLines = snapshot?.totalLinesEdited ?? 0;
  const totalAdded = snapshot?.totalLinesAdded ?? 0;
  const totalRemoved = snapshot?.totalLinesRemoved ?? 0;

  // 首次进入时 head 区域的「总数」展示：focused 命中今天则用当天数据并 caption 切到「当天」；
  // hover 时回到「近一年」总计，让 head 维持「近一年」语义不变。
  const headFromFocused = focusTodayOnOpen && !hoveredDate && focusedDay != null;
  const headLines = headFromFocused ? focusedDay!.linesEdited : totalLines;
  const headAdded = headFromFocused ? focusedDay!.linesAdded : totalAdded;
  const headRemoved = headFromFocused ? focusedDay!.linesRemoved : totalRemoved;
  const headCaption = headFromFocused ? "当天" : "AI 代码编辑量";

  return (
    <div className="app-cc-line-edits">
      <div className="app-cc-line-edits-head">
        <div>
          <div className="app-cc-line-edits-title">{headCaption}</div>
          <div className="app-cc-line-edits-total">{formatLinesEdited(headLines)}</div>
        </div>
        <LineEditsSplitBars added={headAdded} removed={headRemoved} />
      </div>

      {snapshotLoading ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : snapshotError ? (
        <Typography.Text type="danger">{snapshotError}</Typography.Text>
      ) : (
        <>
          <div className="app-cc-line-edits-heatmap-wrap">
            <div className="app-cc-line-edits-heatmap-months">
              <div className="app-cc-line-edits-heatmap-months-spacer" />
              {weeks.map((week, wi) => {
                const label = monthLabels.find((m) => m.weekIndex === wi);
                return (
                  <div key={week.weekStart} className="app-cc-line-edits-heatmap-month-cell">
                    {label?.label ?? ""}
                  </div>
                );
              })}
            </div>
            <div className="app-cc-line-edits-heatmap-grid">
              <div className="app-cc-line-edits-heatmap-weekdays">
                {Array.from({ length: 7 }, (_, row) => (
                  <div key={row} className="app-cc-line-edits-heatmap-weekday">
                    {WEEKDAY_LABEL_ROWS.includes(row as 0 | 2 | 4) ? weekdayLabelForRow(row) : ""}
                  </div>
                ))}
              </div>
              <div
                className="app-cc-line-edits-heatmap-cols"
                onMouseLeave={() => setHoveredDate(null)}
              >
                {weeks.map((week) => (
                  <div
                    key={week.key}
                    className={`app-cc-line-edits-heatmap-col${
                      week.isPlaceholder ? " app-cc-line-edits-heatmap-col--placeholder" : ""
                    }`}
                  >
                    {week.cells.map((cell, row) => {
                      if (week.isPlaceholder) {
                        return (
                          <div
                            key={`${cell.date}-${row}`}
                            className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--placeholder"
                            aria-hidden="true"
                          />
                        );
                      }
                      if (!cell.inRange) {
                        return (
                          <div
                            key={`${cell.date}-${row}`}
                            className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--empty"
                          />
                        );
                      }
                      const level = heatmapLevel(cell.linesEdited, maxLines);
                      const isFocused = focusedDay?.date === cell.date;
                      return (
                        <Popover
                          key={cell.date}
                          trigger="hover"
                          placement="top"
                          mouseEnterDelay={0.08}
                          destroyOnHidden
                          overlayClassName="app-cc-line-edits-cell-popover-overlay"
                          getPopupContainer={() => document.body}
                          onOpenChange={(open) => {
                            if (open) setHoveredDate(cell.date);
                            else setHoveredDate((prev) => (prev === cell.date ? null : prev));
                          }}
                          content={
                            <LineEditsCellPopoverContent
                              date={cell.date}
                              linesEdited={cell.linesEdited}
                              diffCount={cell.diffCount}
                            />
                          }
                        >
                          <div
                            className={`app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l${level}${isFocused ? " app-cc-line-edits-heatmap-cell--focused" : ""}`}
                            aria-label={formatHeatmapDateLabel(cell.date)}
                          />
                        </Popover>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="app-cc-line-edits-heatmap-legend">
              <span>少</span>
              <div className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l0" />
              <div className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l1" />
              <div className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l2" />
              <div className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l3" />
              <div className="app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l4" />
              <span>多</span>
            </div>
          </div>

          <div className="app-cc-line-edits-stats">
            <div
              className={`app-cc-line-edits-stat${focusedDay ? " app-cc-line-edits-stat--focused" : ""}`}
            >
              <div className="app-cc-line-edits-stat-label">
                {focusedDay && hoveredDate ? formatHeatmapDateLabel(focusedDay.date).slice(0, 5) : "当天"}
              </div>
              <div className="app-cc-line-edits-stat-value">
                {focusedDay ? (
                  <>
                    {formatLinesEdited(focusedDay.linesEdited)} 行 · {formatLinesEdited(focusedDay.diffCount)} 次
                    <div className="app-cc-line-edits-stat-sub">
                      <span className="app-cc-line-edits-summary--add">+{formatLinesEdited(focusedDay.linesAdded)}</span>
                      <span className="app-cc-line-edits-summary-sep"> / </span>
                      <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(focusedDay.linesRemoved)}</span>
                    </div>
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">最活跃月份</div>
              <div className="app-cc-line-edits-stat-value">{snapshot?.mostActiveMonth ?? "—"}</div>
            </div>
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">最活跃日期</div>
              <div className="app-cc-line-edits-stat-value">{snapshot?.mostActiveDay ?? "—"}</div>
            </div>
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">最近 7 天</div>
              <div className="app-cc-line-edits-stat-value">
                {snapshot?.last7Days ? (
                  <>
                    {formatLinesEdited(snapshot.last7Days.linesEdited)} 行 · {formatLinesEdited(snapshot.last7Days.diffCount)} 次
                    <div className="app-cc-line-edits-stat-sub">
                      <span className="app-cc-line-edits-summary--add">+{formatLinesEdited(snapshot.last7Days.linesAdded)}</span>
                      <span className="app-cc-line-edits-summary-sep"> / </span>
                      <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(snapshot.last7Days.linesRemoved)}</span>
                    </div>
                  </>
                ) : "—"}
              </div>
            </div>
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">最近 30 天</div>
              <div className="app-cc-line-edits-stat-value">
                {snapshot?.last30Days ? (
                  <>
                    {formatLinesEdited(snapshot.last30Days.linesEdited)} 行 · {formatLinesEdited(snapshot.last30Days.diffCount)} 次
                    <div className="app-cc-line-edits-stat-sub">
                      <span className="app-cc-line-edits-summary--add">+{formatLinesEdited(snapshot.last30Days.linesAdded)}</span>
                      <span className="app-cc-line-edits-summary-sep"> / </span>
                      <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(snapshot.last30Days.linesRemoved)}</span>
                    </div>
                  </>
                ) : "—"}
              </div>
            </div>
          </div>

          <div className="app-cc-line-edits-summary">
            {(() => {
              // 合计行 caption + 数据：focused 单日 → 该日数据；首次进入 → 当天数据；否则 → 近一年合计。
              if (focusedDay && hoveredDate) {
                const dateLabel = formatHeatmapDateLabel(focusedDay.date).slice(0, 5);
                return (
                  <>
                    合计（{dateLabel}）：{formatLinesEdited(focusedDay.linesEdited)} 行 · {formatLinesEdited(focusedDay.diffCount)} 次编辑
                    （<span className="app-cc-line-edits-summary--add">+{formatLinesEdited(focusedDay.linesAdded)}</span>
                    <span className="app-cc-line-edits-summary-sep"> / </span>
                    <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(focusedDay.linesRemoved)}</span>）
                  </>
                );
              }
              if (headFromFocused && focusedDay) {
                return (
                  <>
                    合计（当天）：{formatLinesEdited(focusedDay.linesEdited)} 行 · {formatLinesEdited(focusedDay.diffCount)} 次编辑
                    （<span className="app-cc-line-edits-summary--add">+{formatLinesEdited(focusedDay.linesAdded)}</span>
                    <span className="app-cc-line-edits-summary-sep"> / </span>
                    <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(focusedDay.linesRemoved)}</span>）
                  </>
                );
              }
              return (
                <>
                  合计（近一年）：{formatLinesEdited(totalLines)} 行 · {formatLinesEdited(snapshot?.totalDiffCount ?? 0)} 次编辑
                  （<span className="app-cc-line-edits-summary--add">+{formatLinesEdited(totalAdded)}</span>
                  <span className="app-cc-line-edits-summary-sep"> / </span>
                  <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(totalRemoved)}</span>）
                </>
              );
            })()}
          </div>

          {snapshot?.hint ? <div className="app-cc-usage-hint">{snapshot.hint}</div> : null}
          {snapshot && !snapshotLoading ? (
            <div className="app-cc-usage-refresh">
              <Typography.Link onClick={onRefresh}>刷新</Typography.Link>
              {snapshot.eventsParsed > 0 ? (
                <Typography.Text type="secondary">
                  {" "}
                  · 已解析 {snapshot.eventsParsed.toLocaleString()} 条 · {snapshot.scannedFiles} 个文件
                </Typography.Text>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
