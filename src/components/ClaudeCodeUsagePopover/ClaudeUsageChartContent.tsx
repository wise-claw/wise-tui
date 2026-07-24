import { Spin, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  ClaudeUsageBucket,
  ClaudeUsageGranularity,
  ClaudeUsageSeriesPayload,
  ClaudeUsageSnapshotResponse,
} from "../../services/claudeCodeUsage";
import { UsagePillGroup } from "./UsagePillGroup";
import "./index.css";

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

function formatCacheHitRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function cacheInputDenom(b: ClaudeUsageBucket): number {
  return b.inputTokens + b.cacheCreationTokens + b.cacheReadTokens;
}

function hasCacheInputActivity(b: ClaudeUsageBucket | null | undefined): boolean {
  if (!b) return false;
  return cacheInputDenom(b) > 0;
}

const CACHE_HIT_RATE_FORMULA =
  "输入 token 缓存覆盖率 = 缓存读 ÷ (未缓存 + 缓存写 + 缓存读)";

const CACHE_HIT_RATE_FORMULA_FIELDS =
  "cache_read_input_tokens ÷ (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)";

const CACHE_HIT_RATE_NOTE =
  "分母只覆盖输入侧（不含 output），与 ccusage / Claude API 计费口径一致";

function formatCacheHitFormulaSubstitution(
  cacheRead: number,
  input: number,
  cacheCreate: number,
): string {
  const denom = input + cacheCreate + cacheRead;
  if (denom <= 0) return "";
  return `${formatTokensShort(cacheRead)} ÷ (${formatTokensShort(input)} + ${formatTokensShort(cacheCreate)} + ${formatTokensShort(cacheRead)})`;
}

function seriesHasCacheInput(series: ClaudeUsageSeriesPayload | null | undefined): boolean {
  if (!series) return false;
  return series.totalInputTokens + series.totalCacheCreationTokens + series.totalCacheReadTokens > 0;
}

function CacheHitRateFormulaBlock({
  cacheRead,
  input,
  cacheCreate,
  hitRate,
}: {
  cacheRead: number;
  input: number;
  cacheCreate: number;
  hitRate: number | null;
}) {
  const substitution = formatCacheHitFormulaSubstitution(cacheRead, input, cacheCreate);
  return (
    <div className="app-cc-usage-cache-formula">
      <div>{CACHE_HIT_RATE_FORMULA}</div>
      <div className="app-cc-usage-cache-formula-fields">{CACHE_HIT_RATE_FORMULA_FIELDS}</div>
      {substitution ? (
        <div className="app-cc-usage-cache-formula-calc">
          = {substitution}
          {hitRate != null ? ` = ${formatCacheHitRate(hitRate)}` : null}
        </div>
      ) : null}
      <div className="app-cc-usage-cache-formula-note">{CACHE_HIT_RATE_NOTE}</div>
    </div>
  );
}

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

export interface ClaudeUsageChartContentProps {
  granularity: ClaudeUsageGranularity;
  onGranularityChange: (g: ClaudeUsageGranularity) => void;
  snapshot: ClaudeUsageSnapshotResponse | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
  onRefresh: () => void;
  compact?: boolean;
  /**
   * 弹窗刚打开时为 true：默认聚焦最末一根柱（当天），summary/formula 行展示当日数据；
   * hover 任意柱时切换到 hover 桶，鼠标离开后保持当前聚焦（不再回落聚合）。
   * 关闭后下次打开再激活。
   */
  focusTodayOnOpen?: boolean;
}

const GRANULARITY_OPTIONS = [
  { value: "day" as const, label: "日" },
  { value: "week" as const, label: "周" },
  { value: "month" as const, label: "月" },
];

interface UsageSummaryView {
  caption: string;
  /** 「输入+缓存」合计：input + cache_creation + cache_read，与命中率分母严格对齐。 */
  inputPlusCacheTokens: number;
  /** 完整合计：input + output + cache_creation + cache_read；为 null 时表示暂无数据。 */
  totalTokens: number | null;
  costUsd: number;
  cacheHitRate: number | null;
  showCacheHit: boolean;
  cacheRead: number;
  cacheCreate: number;
  input: number;
  outputTokens: number;
  hasCacheInput: boolean;
  isDetail: boolean;
}

function buildSeriesSummaryView(series: ClaudeUsageSeriesPayload): UsageSummaryView {
  const inputPlusCache =
    series.totalInputTokens + series.totalCacheCreationTokens + series.totalCacheReadTokens;
  return {
    caption: `合计（${series.periodCaption}）`,
    inputPlusCacheTokens: inputPlusCache,
    // series 合计含 output，拆两段展示后这里仍保留全量供后续可能的复用（如 hover 汇总）。
    totalTokens: series.totalTokens,
    costUsd: series.totalCostUsd,
    cacheHitRate: series.cacheHitRate,
    showCacheHit: series.cacheHitRate != null || series.totalCacheReadTokens > 0,
    cacheRead: series.totalCacheReadTokens,
    cacheCreate: series.totalCacheCreationTokens,
    input: series.totalInputTokens,
    outputTokens: series.totalOutputTokens,
    hasCacheInput: inputPlusCache > 0,
    isDetail: false,
  };
}

function buildBucketSummaryView(bucket: ClaudeUsageBucket, granularity: ClaudeUsageGranularity): UsageSummaryView {
  const inputPlusCache = bucket.inputTokens + bucket.cacheCreationTokens + bucket.cacheReadTokens;
  return {
    caption: usageLabelFromSortKey(granularity, bucket.sortKey),
    inputPlusCacheTokens: inputPlusCache,
    totalTokens: bucket.totalTokens,
    costUsd: bucket.costUsd,
    cacheHitRate: bucket.cacheHitRate,
    showCacheHit: hasCacheInputActivity(bucket),
    cacheRead: bucket.cacheReadTokens,
    cacheCreate: bucket.cacheCreationTokens,
    input: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    hasCacheInput: inputPlusCache > 0,
    isDetail: true,
  };
}

function UsageSummaryBar({ view }: { view: UsageSummaryView }) {
  const showBreakdown = view.isDetail && (view.hasCacheInput || view.outputTokens > 0);

  // series 合计行：拆成「输入+缓存 X tokens」与「输出 Y tokens」两段，
  // 与「输入 token 缓存覆盖率」分母严格对齐，避免合计 2800M 看上去与算式 2773M 对不上。
  // detail（hover 单桶）模式保留单值 `X tokens` 合计 + breakdown，避免重复展示同一份 output。
  const showSplitTotal = !view.isDetail && view.totalTokens != null;

  return (
    <div className={`app-cc-usage-total${view.isDetail ? " app-cc-usage-total--detail" : ""}`}>
      <div className="app-cc-usage-total__main">
        <span className="app-cc-usage-total__caption">{view.caption}</span>
        <span className="app-cc-usage-total__sep">：</span>
        {showSplitTotal ? (
          <span className="app-cc-usage-total__hero">
            <span>输入+缓存 {formatTokensShort(view.inputPlusCacheTokens)}</span>
            <span className="app-cc-usage-total__unit"> tokens</span>
            <span className="app-cc-usage-total__sep">·</span>
            <span>输出 {formatTokensShort(view.outputTokens)}</span>
            <span className="app-cc-usage-total__unit"> tokens</span>
          </span>
        ) : (
          <span className="app-cc-usage-total__hero">
            {formatTokensShort(view.totalTokens ?? 0)}
            <span className="app-cc-usage-total__unit"> tokens</span>
          </span>
        )}
        <span className="app-cc-usage-total__sep">·</span>
        <span className="app-cc-usage-total__meta">{formatUsd(view.costUsd)}</span>
        {view.showCacheHit ? (
          <>
            <span className="app-cc-usage-total__sep">·</span>
            <span className="app-cc-usage-total__meta">
              输入 token 缓存覆盖率{" "}
              <span className="app-cc-usage-total__cache-hit">{formatCacheHitRate(view.cacheHitRate)}</span>
            </span>
          </>
        ) : null}
      </div>
      {showBreakdown ? (
        <div className="app-cc-usage-total__breakdown">
          {view.hasCacheInput ? (
            <>
              读 {formatTokensShort(view.cacheRead)} · 写 {formatTokensShort(view.cacheCreate)} · 未缓存{" "}
              {formatTokensShort(view.input)}
            </>
          ) : null}
          {view.outputTokens > 0 ? (
            <>
              {view.hasCacheInput ? <span className="app-cc-usage-total__sep">·</span> : null}
              输出 {formatTokensShort(view.outputTokens)} tokens
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ClaudeUsageChartContent({
  granularity,
  onGranularityChange,
  snapshot,
  snapshotLoading,
  snapshotError,
  onRefresh,
  compact = false,
  focusTodayOnOpen = false,
}: ClaudeUsageChartContentProps) {
  const [hoveredBucket, setHoveredBucket] = useState<ClaudeUsageBucket | null>(null);
  const series = useMemo(() => pickSeries(snapshot, granularity), [snapshot, granularity]);
  const buckets: ClaudeUsageBucket[] = series?.buckets ?? [];

  // 「聚焦桶」= hover 桶优先；否则取系列末桶（当天），仅首次进入激活。
  // 用户首次打开时 summary/formula 默认展示当天，hover 任意桶切到该桶，鼠标离开后保持当前聚焦。
  const focusBucket = useMemo<ClaudeUsageBucket | null>(() => {
    if (hoveredBucket) return hoveredBucket;
    if (!focusTodayOnOpen) return null;
    if (buckets.length === 0) return null;
    const last = buckets[buckets.length - 1];
    return last ?? null;
  }, [hoveredBucket, focusTodayOnOpen, buckets]);

  const maxTok = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.totalTokens > m) m = b.totalTokens;
    }
    return m > 0 ? m : 1;
  }, [buckets]);

  useEffect(() => {
    setHoveredBucket(null);
  }, [granularity]);

  const summaryView = useMemo((): UsageSummaryView | null => {
    if (focusBucket) {
      const view = buildBucketSummaryView(focusBucket, granularity);
      // 首次进入 + 没有 hover 时，聚焦当天 = 整段「合计」的局部视角，caption 收口为「合计（当天）」。
      if (!hoveredBucket && focusTodayOnOpen) {
        return { ...view, caption: "合计（当天）" };
      }
      return view;
    }
    if (series) return buildSeriesSummaryView(series);
    return null;
  }, [granularity, focusBucket, hoveredBucket, focusTodayOnOpen]);

  const formulaView = useMemo(() => {
    if (focusBucket && hasCacheInputActivity(focusBucket)) {
      return {
        cacheRead: focusBucket.cacheReadTokens,
        input: focusBucket.inputTokens,
        cacheCreate: focusBucket.cacheCreationTokens,
        hitRate: focusBucket.cacheHitRate,
      };
    }
    if (series && seriesHasCacheInput(series)) {
      return {
        cacheRead: series.totalCacheReadTokens,
        input: series.totalInputTokens,
        cacheCreate: series.totalCacheCreationTokens,
        hitRate: series.cacheHitRate,
      };
    }
    return null;
  }, [focusBucket, series]);

  return (
    <div className={`app-cc-usage-popover${compact ? " app-cc-usage-popover--compact" : ""}`}>
      <UsagePillGroup
        value={granularity}
        options={GRANULARITY_OPTIONS}
        onChange={onGranularityChange}
        size="sm"
        ariaLabel="时间粒度"
        className="app-cc-usage-granularity"
      />
      {snapshotLoading ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : snapshotError ? (
        <Typography.Text type="danger">{snapshotError}</Typography.Text>
      ) : (
        <>
          <div className="app-cc-usage-chart" onMouseLeave={() => setHoveredBucket(null)}>
            {buckets.map((b) => {
              const h = Math.max(2, Math.round((b.totalTokens / maxTok) * 100));
              const isActive = focusBucket?.sortKey === b.sortKey;
              return (
                <div
                  key={b.sortKey}
                  className="app-cc-usage-bar-wrap"
                  onMouseEnter={() => setHoveredBucket(b)}
                >
                  <div className="app-cc-usage-bar-slot" style={{ height: `${h}%` }}>
                    <div
                      className={`app-cc-usage-bar${isActive ? " app-cc-usage-bar--active" : ""}`}
                      aria-label={usageLabelFromSortKey(granularity, b.sortKey)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {summaryView ? <UsageSummaryBar view={summaryView} /> : null}
          {formulaView ? (
            <CacheHitRateFormulaBlock
              cacheRead={formulaView.cacheRead}
              input={formulaView.input}
              cacheCreate={formulaView.cacheCreate}
              hitRate={formulaView.hitRate}
            />
          ) : null}
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
