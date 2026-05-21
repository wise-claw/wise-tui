import { isTauri } from "@tauri-apps/api/core";
import { Popover, Segmented, Spin, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClaudeUsageBucket,
  ClaudeUsageGranularity,
  ClaudeUsageSeriesPayload,
  ClaudeUsageSnapshotResponse,
} from "../../services/claudeCodeUsage";
import { getClaudeCodeUsageSnapshot } from "../../services/claudeCodeUsage";
import "./index.css";

// ── SVG ──

function IconClaudeUsage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <polygon points="12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="12 7.5 16 9.75 16 14.25 12 16.5 8 14.25 8 9.75" stroke="currentColor" strokeWidth="1.8" strokeOpacity="0.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

// ── Helpers ──

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function formatTokensShort(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** ISO 周年 `isoY`、周序号 `week`（1–53）→ 该周周一（本地时区），与 Rust `iso_week` 语义一致。 */
function isoWeekMondayLocal(isoY: number, week: number): Date {
  const jan4 = new Date(isoY, 0, 4);
  const dow = jan4.getDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - (dow - 1));
  const out = new Date(week1Mon);
  out.setDate(week1Mon.getDate() + (week - 1) * 7);
  return out;
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 与 Rust `label_for_week` 一致：`YYYY-Www` →「2026年5月5日—11日」（ISO 周周一至周日） */
function weekSortKeyToRangeLabel(sortKey: string): string | null {
  const w = /^(\d{4})-W(\d{2})$/.exec(sortKey);
  if (!w) return null;
  const mon = isoWeekMondayLocal(Number(w[1]), Number(w[2]));
  const sun = addLocalDays(mon, 6);
  const y1 = mon.getFullYear();
  const m1 = mon.getMonth() + 1;
  const d1 = mon.getDate();
  const y2 = sun.getFullYear();
  const m2 = sun.getMonth() + 1;
  const d2 = sun.getDate();
  if (y1 === y2) {
    if (m1 === m2) return `${y1}年${m1}月${d1}日—${d2}日`;
    return `${y1}年${m1}月${d1}日—${m2}月${d2}日`;
  }
  return `${y1}年${m1}月${d1}日—${y2}年${m2}月${d2}日`;
}

/** 按当前粒度从 `sortKey` 生成展示文案，避免与周视图标签串用。 */
function usageLabelFromSortKey(g: ClaudeUsageGranularity, sortKey: string): string {
  if (g === "day") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sortKey);
    if (m) return `${Number(m[2])}/${Number(m[3])}`;
    return sortKey;
  }
  if (g === "week") {
    return weekSortKeyToRangeLabel(sortKey) ?? sortKey;
  }
  const mo = /^(\d{4})-(\d{2})$/.exec(sortKey);
  if (mo) return `${mo[1]}年${Number(mo[2])}月`;
  const wk = /^(\d{4})-W(\d{2})$/.exec(sortKey);
  if (wk) {
    const mon = isoWeekMondayLocal(Number(wk[1]), Number(wk[2]));
    return `${mon.getFullYear()}年${mon.getMonth() + 1}月`;
  }
  return sortKey;
}

function pickSeries(snap: ClaudeUsageSnapshotResponse | null, g: ClaudeUsageGranularity): ClaudeUsageSeriesPayload | null {
  if (!snap) return null;
  if (g === "day") return snap.day;
  if (g === "week") return snap.week;
  return snap.month;
}

// ── Content ──

interface ContentProps {
  granularity: ClaudeUsageGranularity;
  onGranularityChange: (g: ClaudeUsageGranularity) => void;
  snapshot: ClaudeUsageSnapshotResponse | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
  onRefresh: () => void;
}

function ClaudeCodeUsagePopoverContent({
  granularity,
  onGranularityChange,
  snapshot,
  snapshotLoading,
  snapshotError,
  onRefresh,
}: ContentProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    setHoverIdx(null);
  }, [granularity]);

  const series = useMemo(() => pickSeries(snapshot, granularity), [snapshot, granularity]);

  const buckets: ClaudeUsageBucket[] = series?.buckets ?? [];
  const maxTok = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.totalTokens > m) m = b.totalTokens;
    }
    return m > 0 ? m : 1;
  }, [buckets]);

  const activeIdx = hoverIdx !== null ? hoverIdx : buckets.length > 0 ? buckets.length - 1 : null;
  const active: ClaudeUsageBucket | null =
    activeIdx !== null && activeIdx >= 0 && activeIdx < buckets.length ? buckets[activeIdx]! : null;

  return (
    <div className="app-cc-usage-popover">
      <Segmented<ClaudeUsageGranularity>
        size="small"
        block
        value={granularity}
        onChange={(v) => {
          const s = String(v);
          if (s === "day" || s === "week" || s === "month") {
            onGranularityChange(s);
          }
        }}
        options={[
          { label: "日", value: "day" },
          { label: "周", value: "week" },
          { label: "月", value: "month" },
        ]}
      />
      {snapshotLoading ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : snapshotError ? (
        <Typography.Text type="danger">{snapshotError}</Typography.Text>
      ) : (
        <>
          <div className="app-cc-usage-chart" onMouseLeave={() => setHoverIdx(null)}>
            {buckets.map((b, i) => {
              const h = Math.max(2, Math.round((b.totalTokens / maxTok) * 100));
              return (
                <div
                  key={b.sortKey}
                  className={`app-cc-usage-bar-wrap${i === activeIdx ? " app-cc-usage-bar-wrap--active" : ""}`}
                  onMouseEnter={() => setHoverIdx(i)}
                >
                  <div className="app-cc-usage-bar" style={{ height: `${h}%` }} />
                </div>
              );
            })}
          </div>
          <div className="app-cc-usage-x-label">
            {active
              ? usageLabelFromSortKey(granularity, active.sortKey)
              : buckets[0]
                ? usageLabelFromSortKey(granularity, buckets[0].sortKey)
                : ""}
          </div>
          {active ? (
            <div className="app-cc-usage-detail">
              {usageLabelFromSortKey(granularity, active.sortKey)}：{formatUsd(active.costUsd)} ·{" "}
              {formatTokensShort(active.totalTokens)} tokens
            </div>
          ) : (
            <div className="app-cc-usage-detail">暂无数据</div>
          )}
          <div className="app-cc-usage-total">
            合计（{series?.periodCaption ?? "—"}）：{formatUsd(series?.totalCostUsd ?? 0)} ·{" "}
            {formatTokensShort(series?.totalTokens ?? 0)} tokens
          </div>
          {snapshot?.hint ? <div className="app-cc-usage-hint">{snapshot.hint}</div> : null}
          {snapshot && !snapshotLoading ? (
            <div className="app-cc-usage-refresh">
              <Typography.Link onClick={onRefresh}>刷新</Typography.Link>
              {snapshot.eventsParsed > 0 ? (
                <Typography.Text type="secondary">
                  {" "}
                  · 已解析 {snapshot.eventsParsed.toLocaleString()} 条用量 · {snapshot.scannedFiles} 个文件
                </Typography.Text>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Export ──

export function ClaudeCodeUsageHeaderBtn() {
  const [open, setOpen] = useState(false);
  const [granularity, setGranularity] = useState<ClaudeUsageGranularity>("day");
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshotResponse | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!isTauri()) {
      setSnapshot(null);
      setSnapshotError("用量统计仅在 Wise 桌面版中可用。");
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const res = await getClaudeCodeUsageSnapshot();
      setSnapshot(res);
      if (!res) {
        setSnapshotError("无法读取用量数据。");
      }
    } catch (e) {
      setSnapshot(null);
      setSnapshotError(e instanceof Error ? e.message : String(e));
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (snapshot !== null || snapshotLoading || snapshotError) return;
    void loadSnapshot();
  }, [open, snapshot, snapshotLoading, snapshotError, loadSnapshot]);

  const handleRefresh = useCallback(() => {
    setSnapshot(null);
    setSnapshotError(null);
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setGranularity("day");
          setSnapshotError(null);
        }
      }}
      trigger="click"
      placement="bottomRight"
      destroyOnHidden
      content={
        <ClaudeCodeUsagePopoverContent
          granularity={granularity}
          onGranularityChange={setGranularity}
          snapshot={snapshot}
          snapshotLoading={snapshotLoading}
          snapshotError={snapshotError}
          onRefresh={handleRefresh}
        />
      }
    >
      <Tooltip title="Claude Code 用量（本机 JSONL，对齐 ccusage）" mouseEnterDelay={0.35}>
        <button type="button" className="app-left-sidebar-topbar-btn" aria-label="Claude Code 用量统计">
          <IconClaudeUsage />
        </button>
      </Tooltip>
    </Popover>
  );
}
