import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  Dropdown,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { CopyOutlined, DownloadOutlined, ExportOutlined } from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeSession } from "../../types";
import type { SessionLinkRecord } from "../../types/sessionLink";
import { loadClaudeSessionJsonl } from "../../services/claudeDisk";
import { useFccSessionTraces } from "../../hooks/useFccSessionTraces";
import { writeTextFileAbsolute } from "../../services/sessionLink";
import {
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  subscribeClaudeLlmProxyStore,
} from "../../stores/claudeLlmProxyStore";
import { countSessionLinkStats } from "../../utils/buildSessionLinkRecords";
import { filterLlmProxyRecordsForDisplay } from "../../utils/llmProxyTrafficDisplay";
import {
  SESSION_LINK_FILTER_OPTIONS,
  computeSessionLinkTurnMetrics,
  filterSessionLinkRecords,
  type SessionLinkFilterPreset,
} from "../../utils/sessionLinkFilters";
import { buildSessionLinkRecordsFromSources } from "../../utils/sessionLinkPipeline";
import {
  buildSessionLinkExportBundle,
  serializeSessionLinkExportBundle,
  stripSessionLinkDetailsForMetadataExport,
} from "../../utils/sessionLinkExport";
import { buildTrajectorySequenceModel } from "../../utils/claudeSessionTrajectorySequence";
import { ClaudeSessionSequenceDiagram } from "./ClaudeSessionSequenceDiagram";
import "./SessionDataLinkDrawer.css";

const { Text, Paragraph } = Typography;

const JSONL_TAIL = 8000;

const LAYER_LABELS: Record<SessionLinkRecord["layer"], string> = {
  input: "输入",
  protocol: "协议",
  tool: "工具",
  hook: "Hook",
  http: "HTTP",
  fcc_upstream: "FCC 上游",
};

function layerTagColor(layer: SessionLinkRecord["layer"]): string {
  switch (layer) {
    case "input":
      return "blue";
    case "tool":
      return "purple";
    case "http":
      return "orange";
    case "hook":
      return "cyan";
    case "fcc_upstream":
      return "geekblue";
    default:
      return "default";
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  session: ClaudeSession | null;
}

export function SessionDataLinkDrawer({ open, onClose, session }: Props) {
  const [viewMode, setViewMode] = useState<"list" | "diagram">("list");
  const [filterPreset, setFilterPreset] = useState<SessionLinkFilterPreset>("all");
  const [jsonlLines, setJsonlLines] = useState<string[] | null>(null);
  const [jsonlLoading, setJsonlLoading] = useState(false);
  const [jsonlError, setJsonlError] = useState<string | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEndExclusive, setVisibleEndExclusive] = useState(1);
  const [proxySnap, setProxySnap] = useState(getClaudeLlmProxyStoreSnapshot);

  const messages = session?.messages ?? [];
  const repositoryPath = session?.repositoryPath?.trim() ?? "";
  const claudeSessionId = session?.claudeSessionId?.trim() ?? "";
  const canLoadDisk = Boolean(repositoryPath && claudeSessionId);

  useEffect(() => {
    if (!open) return;
    void refreshClaudeLlmProxyStatus(repositoryPath || undefined);
    return subscribeClaudeLlmProxyStore(() => {
      setProxySnap(getClaudeLlmProxyStoreSnapshot());
    });
  }, [open, repositoryPath]);

  useEffect(() => {
    if (!open) {
      setViewMode("list");
      setFilterPreset("all");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setJsonlLines(null);
    setJsonlError(null);
    if (!canLoadDisk) return;
    let cancelled = false;
    setJsonlLoading(true);
    void loadClaudeSessionJsonl(repositoryPath, claudeSessionId, { tailLines: JSONL_TAIL })
      .then((lines) => {
        if (!cancelled) setJsonlLines(lines);
      })
      .catch((e: unknown) => {
        if (!cancelled) setJsonlError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setJsonlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canLoadDisk, repositoryPath, claudeSessionId]);

  const fccSinceMs = session?.createdAt ? session.createdAt - 60_000 : undefined;
  const { fccAligned, traces: fccTraces, loading: fccLoading } = useFccSessionTraces({
    open,
    sessionHint: claudeSessionId || undefined,
    sinceMs: fccSinceMs,
  });

  const llmProxyRecords = useMemo(
    () => filterLlmProxyRecordsForDisplay(proxySnap.records),
    [proxySnap.records],
  );

  const linkRecords = useMemo(
    () =>
      buildSessionLinkRecordsFromSources({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        llmProxyRecords,
        fccTraces: fccAligned ? fccTraces : undefined,
      }),
    [messages, jsonlLines, llmProxyRecords, fccAligned, fccTraces],
  );

  const filteredRecords = useMemo(
    () => filterSessionLinkRecords(linkRecords, filterPreset),
    [linkRecords, filterPreset],
  );

  const turnMetrics = useMemo(() => computeSessionLinkTurnMetrics(linkRecords), [linkRecords]);

  const stats = useMemo(() => countSessionLinkStats(linkRecords), [linkRecords]);

  const events = useMemo(
    () =>
      buildTrajectorySequenceModel(messages, jsonlLines ?? undefined, {
        fccTraces: fccAligned ? fccTraces : undefined,
        llmProxyRecords: llmProxyRecords.length > 0 ? llmProxyRecords : undefined,
      }),
    [messages, jsonlLines, fccAligned, fccTraces, llmProxyRecords],
  );

  const buildExportBundle = useCallback(
    (records: readonly SessionLinkRecord[]) => {
      if (!session) return null;
      return buildSessionLinkExportBundle({
        messages,
        jsonlLines: jsonlLines ?? undefined,
        llmProxyRecords,
        fccTraces: fccAligned ? fccTraces : undefined,
        wiseTabSessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        repositoryPath: session.repositoryPath,
        records,
      });
    },
    [session, messages, jsonlLines, llmProxyRecords, fccAligned, fccTraces],
  );

  const exportBundle = useMemo(
    () => buildExportBundle(filteredRecords),
    [buildExportBundle, filteredRecords],
  );

  useEffect(() => {
    const n = events.length;
    const span = Math.min(48, Math.max(8, n));
    if (n === 0) {
      setVisibleStart(0);
      setVisibleEndExclusive(1);
      return;
    }
    const tailStart = Math.max(0, n - span);
    const firstUserIdx = events.findIndex((e) => e.kind === "user_input");
    const start =
      firstUserIdx >= 0 && firstUserIdx < tailStart ? Math.max(0, firstUserIdx) : tailStart;
    setVisibleStart(start);
    setVisibleEndExclusive(Math.min(start + span, n));
  }, [events]);

  const onRangeChange = useCallback((start: number, endExclusive: number) => {
    setVisibleStart(start);
    setVisibleEndExclusive(Math.max(start + 1, endExclusive));
  }, []);

  const runExport = useCallback(
    async (metadataOnly: boolean) => {
      if (!exportBundle || !session) return;
      const bundle = metadataOnly
        ? stripSessionLinkDetailsForMetadataExport(exportBundle)
        : exportBundle;
      const text = serializeSessionLinkExportBundle(bundle);
      const sid = session.claudeSessionId?.slice(0, 8) ?? session.id.slice(0, 8);
      const defaultName = `session-link-${sid}-${Date.now()}${metadataOnly ? "-meta" : ""}.json`;
      try {
        const path = await save({
          defaultPath: defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!path) return;
        await writeTextFileAbsolute(path, text);
        message.success(metadataOnly ? "已导出元数据链路包" : "已导出完整链路包");
      } catch (e) {
        message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [exportBundle, session],
  );

  const handleCopyExport = useCallback(async () => {
    if (!exportBundle) return;
    const text = serializeSessionLinkExportBundle(exportBundle);
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制当前筛选结果的链路 JSON");
    } catch {
      message.error("复制失败");
    }
  }, [exportBundle]);

  const exportMenuItems = useMemo(
    () => [
      { key: "full", label: "完整导出（含 detail）", onClick: () => void runExport(false) },
      { key: "meta", label: "仅元数据（无 detail）", onClick: () => void runExport(true) },
    ],
    [runExport],
  );

  const collapseItems = useMemo(() => {
    const byTurn = new Map<number, SessionLinkRecord[]>();
    for (const r of filteredRecords) {
      const list = byTurn.get(r.turnIndex) ?? [];
      list.push(r);
      byTurn.set(r.turnIndex, list);
    }
    return [...byTurn.entries()]
      .sort(([a], [b]) => a - b)
      .map(([turn, recs]) => {
        const metric = turnMetrics.find((m) => m.turnIndex === turn);
        return {
          key: String(turn),
          label: (
            <span className="app-session-data-link__turn-label">
              轮次 {turn}
              {metric ? (
                <Text type="secondary" className="app-session-data-link__turn-meta">
                  {formatDuration(metric.durationMs)} · {recs.length} 条
                  {metric.httpObserved > 0 ? ` · HTTP ${metric.httpObserved}` : ""}
                </Text>
              ) : (
                <Text type="secondary" className="app-session-data-link__turn-meta">
                  {recs.length} 条
                </Text>
              )}
            </span>
          ),
          children: (
            <ul className="app-session-data-link__record-list">
              {recs.map((r) => (
                <li
                  key={r.id}
                  className={
                    "app-session-data-link__record" +
                    (r.kind === "api_request" && !r.observed
                      ? " app-session-data-link__record--inferred"
                      : "")
                  }
                >
                  <div className="app-session-data-link__record-head">
                    <Text type="secondary" className="app-session-data-link__record-time">
                      {formatTime(r.timestampMs)}
                    </Text>
                    <Tag color={layerTagColor(r.layer)}>{LAYER_LABELS[r.layer]}</Tag>
                    <Tag>{r.kind}</Tag>
                    {r.layer === "http" ? (
                      <Tag color={r.observed ? "success" : "warning"}>
                        {r.observed ? "已观测" : "未观测"}
                      </Tag>
                    ) : null}
                    <Tag className="app-session-data-link__source-tag">{r.source}</Tag>
                  </div>
                  <div className="app-session-data-link__record-summary">{r.summary}</div>
                  {r.detail?.trim() ? (
                    <pre className="app-session-data-link__record-detail">{r.detail}</pre>
                  ) : null}
                </li>
              ))}
            </ul>
          ),
        };
      });
  }, [filteredRecords, turnMetrics]);

  const showFccHint =
    fccAligned &&
    stats.httpInferred > 0 &&
    stats.httpObserved === 0 &&
    fccTraces.length === 0 &&
    !fccLoading;

  return (
    <Drawer
      title={
        session
          ? `全链路分析 · 主会话（${session.repositoryName.trim() || "未命名"}）`
          : "全链路分析"
      }
      placement="right"
      size={880}
      destroyOnClose
      open={open}
      onClose={onClose}
      extra={
        <Space size={8} wrap>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!exportBundle}
            onClick={() => void handleCopyExport()}
          >
            复制 JSON
          </Button>
          <Dropdown menu={{ items: exportMenuItems }} disabled={!exportBundle}>
            <Button size="small" type="primary" icon={<DownloadOutlined />} disabled={!exportBundle}>
              导出
            </Button>
          </Dropdown>
        </Space>
      }
      styles={{ body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" } }}
    >
      <div className="app-session-data-link">
        {!session ? (
          <Empty className="app-session-data-link__empty" description="请先打开一个会话" />
        ) : (
          <>
            <div className="app-session-data-link__toolbar">
              <Segmented
                size="small"
                value={viewMode}
                onChange={(v) => setViewMode(v as "list" | "diagram")}
                options={[
                  { label: "链路列表", value: "list" },
                  { label: "序列图", value: "diagram" },
                ]}
              />
              {viewMode === "list" ? (
                <Select
                  size="small"
                  className="app-session-data-link__filter"
                  value={filterPreset}
                  onChange={setFilterPreset}
                  options={SESSION_LINK_FILTER_OPTIONS}
                  aria-label="链路过滤"
                />
              ) : null}
            </div>

            <div className="app-session-data-link__stats">
              <Text type="secondary">
                轮次 {stats.turns} · 工具 {stats.tools} · HTTP 已观测 {stats.httpObserved} · 推断{" "}
                {stats.httpInferred}
                {llmProxyRecords.length > 0 ? ` · LLM 代理 ${llmProxyRecords.length}` : ""}
                {fccAligned && fccTraces.length > 0 ? ` · FCC ${fccTraces.length}` : ""}
                {fccAligned && fccLoading ? " · FCC 加载中" : ""}
              </Text>
            </div>

            {showFccHint ? (
              <Alert
                className="app-session-data-link__alert"
                type="info"
                showIcon
                message="FCC 直连：HTTP 未观测"
                description={
                  <>
                    可将 trace 写入 <Text code>~/.fcc/traces/**/*.json</Text>（见 design 方案），或临时开启顶栏
                    「LLM 代理」、上游指向 FCC 地址捕获 HTTP。
                  </>
                }
              />
            ) : null}

            {fccAligned && fccTraces.length > 0 ? (
              <Alert
                className="app-session-data-link__alert"
                type="success"
                showIcon
                message={`已合并 ${fccTraces.length} 条 FCC trace（模型泳道接口）`}
              />
            ) : null}

            {session.diskTranscriptPartial && canLoadDisk ? (
              <Alert
                className="app-session-data-link__alert"
                type="warning"
                showIcon
                message="消息可能仅为磁盘尾部子集，链路以已加载内容为准。"
              />
            ) : null}

            {canLoadDisk ? (
              <div className="app-session-data-link__disk">
                {jsonlLoading ? (
                  <span>
                    <Spin size="small" /> 合并 JSONL…
                  </span>
                ) : jsonlError ? (
                  <Text type="danger">JSONL：{jsonlError}</Text>
                ) : jsonlLines ? (
                  <Text type="secondary">已合并 {jsonlLines.length} 行 JSONL</Text>
                ) : null}
              </div>
            ) : (
              <Paragraph type="secondary" className="app-session-data-link__disk">
                无 Claude 会话 ID，仅内存消息（无 Hooks 等磁盘补充）。
              </Paragraph>
            )}

            <div className="app-session-data-link__body">
              {viewMode === "list" ? (
                filteredRecords.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无链路记录" />
                ) : (
                  <Collapse
                    className="app-session-data-link__collapse"
                    items={collapseItems}
                    defaultActiveKey={collapseItems.map((i) => i.key)}
                  />
                )
              ) : events.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无序列事件" />
              ) : (
                <ClaudeSessionSequenceDiagram
                  events={events}
                  visibleStart={visibleStart}
                  visibleEndExclusive={visibleEndExclusive}
                  onVisibleRangeChange={onRangeChange}
                  markInferredHttp
                />
              )}
            </div>

            <footer className="app-session-data-link__foot">
              <Typography.Link
                href="design/session-data-link-observability/README.md"
                onClick={(e) => {
                  e.preventDefault();
                  message.info("方案：design/session-data-link-observability/");
                }}
              >
                <ExportOutlined /> 方案说明
              </Typography.Link>
            </footer>
          </>
        )}
      </div>
    </Drawer>
  );
}
