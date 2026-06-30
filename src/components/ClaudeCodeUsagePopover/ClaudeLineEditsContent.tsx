import { Popover, Spin, Typography } from "antd";
import { useMemo } from "react";
import type { ClaudeLineEditsSnapshotResponse } from "../../services/claudeCodeUsage";
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
}: ClaudeLineEditsContentProps) {
  const { weeks, monthLabels } = useMemo(
    () => buildLineEditsHeatmapWeeks(snapshot?.days ?? []),
    [snapshot?.days],
  );

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

  return (
    <div className="app-cc-line-edits">
      <div className="app-cc-line-edits-head">
        <div>
          <div className="app-cc-line-edits-title">AI 代码编辑量</div>
          <div className="app-cc-line-edits-total">{formatLinesEdited(totalLines)}</div>
        </div>
        <LineEditsSplitBars added={totalAdded} removed={totalRemoved} />
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
              <div className="app-cc-line-edits-heatmap-cols">
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
                      return (
                        <Popover
                          key={cell.date}
                          trigger="hover"
                          placement="top"
                          mouseEnterDelay={0.08}
                          destroyOnHidden
                          overlayClassName="app-cc-line-edits-cell-popover-overlay"
                          getPopupContainer={() => document.body}
                          content={
                            <LineEditsCellPopoverContent
                              date={cell.date}
                              linesEdited={cell.linesEdited}
                              diffCount={cell.diffCount}
                            />
                          }
                        >
                          <div
                            className={`app-cc-line-edits-heatmap-cell app-cc-line-edits-heatmap-cell--l${level}`}
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
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">最长连续</div>
              <div className="app-cc-line-edits-stat-value">{snapshot?.longestStreakDays ?? 0} 天</div>
            </div>
            <div className="app-cc-line-edits-stat">
              <div className="app-cc-line-edits-stat-label">当前连续</div>
              <div className="app-cc-line-edits-stat-value">{snapshot?.currentStreakDays ?? 0} 天</div>
            </div>
          </div>

          <div className="app-cc-line-edits-summary">
            合计（近一年）：{formatLinesEdited(totalLines)} 行 · {formatLinesEdited(snapshot?.totalDiffCount ?? 0)} 次编辑
            （<span className="app-cc-line-edits-summary--add">+{formatLinesEdited(totalAdded)}</span>
            <span className="app-cc-line-edits-summary-sep"> / </span>
            <span className="app-cc-line-edits-summary--remove">−{formatLinesEdited(totalRemoved)}</span>）
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
