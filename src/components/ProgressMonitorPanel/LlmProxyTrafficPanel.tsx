import { Alert, Button, Collapse, Input, Segmented, Switch, message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DeleteOutlined,
  ThunderboltOutlined,
  FieldTimeOutlined,
  GlobalOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import type { ClaudeLlmProxyRecord } from "../../services/claudeLlmProxy";
import {
  applyClaudeLlmProxyConfig,
  clearClaudeLlmProxyStore,
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  subscribeClaudeLlmProxyStore,
} from "../../stores/claudeLlmProxyStore";
import {
  getOpencodeGoProxyStatus,
  type OpencodeGoProxyStatus,
} from "../../services/opencodeGoProxy";
import {
  anthropicProxyConflictMessage,
  resolveAnthropicProxyConflict,
} from "../../utils/anthropicProxyConflict";
import { filterLlmProxyRecordsForDisplay } from "../../utils/llmProxyTrafficDisplay";
import {
  formatHttpTraceTimestampCompact,
  formatHttpTraceTimestampFull,
} from "../../utils/formatHttpTraceTimestamp";
import { resolveProxyTtftMs, resolveProxyFirstByteMs } from "../../utils/llmProxyTtft";
import {
  exportLlmProxyRecordsJson,
  filterLlmProxyRecordsByPanelQuery,
  formatTokenCountShort,
  parseModelFromLlmProxyRequest,
  parseUsageFromLlmProxyRecord,
  summarizeLlmProxyRecords,
  type LlmProxyFilterKind,
} from "../../utils/llmProxyRecordMeta";
import { HttpBodyJsonViewer } from "./HttpBodyJsonViewer";
import "./LlmProxyTrafficPanel.css";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function RecordSummary({ record }: { record: ClaudeLlmProxyRecord }) {
  const isSuccess = record.statusCode != null && record.statusCode >= 200 && record.statusCode < 300;
  const isError = record.statusCode != null && record.statusCode >= 400;
  const ttftMs = resolveProxyTtftMs(record);
  const ttfbMs = resolveProxyFirstByteMs(record);
  const ttftLikelyMisread =
    record.isStreaming &&
    ttftMs != null &&
    ttftMs > 0 &&
    record.durationMs > 0 &&
    ttftMs >= record.durationMs * 0.9;

  const methodColors: Record<string, { bg: string; text: string; border: string }> = {
    POST: {
      bg: "rgba(99, 102, 241, 0.08)",
      text: "#6366f1",
      border: "rgba(99, 102, 241, 0.25)",
    },
    GET: {
      bg: "rgba(16, 185, 129, 0.08)",
      text: "#10b981",
      border: "rgba(16, 185, 129, 0.25)",
    },
    PUT: {
      bg: "rgba(245, 158, 11, 0.08)",
      text: "#f59e0b",
      border: "rgba(245, 158, 11, 0.25)",
    },
    DELETE: {
      bg: "rgba(239, 68, 68, 0.08)",
      text: "#ef4444",
      border: "rgba(239, 68, 68, 0.25)",
    },
  };

  const defaultColor = {
    bg: "var(--ant-color-fill-quaternary)",
    text: "var(--ant-color-text-secondary)",
    border: "var(--ant-color-border-secondary)",
  };

  const mStyle = methodColors[record.method.toUpperCase()] || defaultColor;
  const model = parseModelFromLlmProxyRequest(record.requestBodyPreview);
  const usage = parseUsageFromLlmProxyRecord(record);

  return (
    <div className="app-llm-proxy-record__summary" onClick={(e) => e.stopPropagation()}>
      <div className="app-llm-proxy-record__summary-left">
        <span
          className="app-llm-proxy-record__time"
          title={formatHttpTraceTimestampFull(record.timestampMs)}
        >
          <FieldTimeOutlined style={{ marginRight: 3, opacity: 0.7 }} />
          {formatHttpTraceTimestampCompact(record.timestampMs)}
        </span>

        <span
          className="app-llm-proxy-record__method-badge"
          style={{
            backgroundColor: mStyle.bg,
            color: mStyle.text,
            borderColor: mStyle.border,
          }}
        >
          {record.method}
        </span>

        <span className="app-llm-proxy-record__path-wrapper" title={record.path}>
          {record.path}
        </span>
      </div>

      <div className="app-llm-proxy-record__summary-right">
        {model ? (
          <span className="app-llm-proxy-record__stream-badge" title={`模型: ${model}`}>
            {model.length > 18 ? `${model.slice(0, 16)}…` : model}
          </span>
        ) : null}
        {usage ? (
          <span
            className="app-llm-proxy-record__metric-item app-llm-proxy-record__token-badge"
            title={`Token 用量 — 输入 ${usage.inputTokens}（含缓存读 ${usage.cacheReadTokens}）/ 输出 ${usage.outputTokens}`}
          >
            <span>↑{formatTokenCountShort(usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens)}</span>
            <span>↓{formatTokenCountShort(usage.outputTokens)}</span>
          </span>
        ) : null}
        {record.isStreaming ? (
          <span className="app-llm-proxy-record__stream-badge">流式</span>
        ) : null}

        <div className="app-llm-proxy-record__metrics">
          <span
            className="app-llm-proxy-record__metric-item"
            title={`请求体: ${formatBytes(record.requestBytes)}`}
          >
            <ArrowUpOutlined style={{ fontSize: 9, opacity: 0.65 }} />
            <span>{formatBytes(record.requestBytes)}</span>
          </span>

          <span
            className="app-llm-proxy-record__metric-item"
            title={`响应体: ${formatBytes(record.responseBytes)}`}
          >
            <ArrowDownOutlined style={{ fontSize: 9, opacity: 0.65 }} />
            <span>{formatBytes(record.responseBytes)}</span>
          </span>

          <span className="app-llm-proxy-record__metric-item" title={`总耗时：请求体就绪后至响应结束（含上游处理${record.isStreaming ? "与整段流式输出" : ""}）`}>
            <ThunderboltOutlined style={{ fontSize: 9, color: "#eab308", opacity: 0.9 }} />
            <span>{record.durationMs}ms</span>
          </span>

          {ttfbMs != null && ttfbMs > 0 ? (
            <span
              className="app-llm-proxy-record__metric-item"
              title={`首字节 TTFB：上游开始返回 body（含连接与首包）`}
            >
              <span className="app-llm-proxy-record__ttft-label">TTFB</span>
              <span>{ttfbMs}ms</span>
            </span>
          ) : null}

          {record.isStreaming && ttftMs != null ? (
            <span
              className="app-llm-proxy-record__metric-item"
              title={
                ttftLikelyMisread
                  ? `首 Token TTFT: ${ttftMs}ms（接近总耗时，可能含长思考/上游缓冲，或事件格式未早期识别；请看 TTFB 区分网络与生成）`
                  : `首 Token TTFT: ${ttftMs}ms`
              }
            >
              <span className="app-llm-proxy-record__ttft-label">TTFT</span>
              <span>{ttftMs}ms</span>
            </span>
          ) : null}

          {record.statusCode != null ? (
            <span
              className={`app-llm-proxy-record__status-badge ${
                isSuccess
                  ? "app-llm-proxy-record__status-badge--success"
                  : isError
                    ? "app-llm-proxy-record__status-badge--error"
                    : ""
              }`}
            >
              <span className="app-llm-proxy-record__status-dot" />
              {record.statusCode}
            </span>
          ) : (
            <span className="app-llm-proxy-record__status-badge app-llm-proxy-record__status-badge--error">
              <span className="app-llm-proxy-record__status-dot" />
              失败
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  repositoryPath?: string;
  /** 顶栏 Popover 内使用更宽的固定尺寸 */
  variant?: "sidebar" | "popover";
}

export function LlmProxyTrafficPanel({ repositoryPath, variant = "sidebar" }: Props) {
  const snapshot = useSyncExternalStore(
    subscribeClaudeLlmProxyStore,
    getClaudeLlmProxyStoreSnapshot,
    getClaudeLlmProxyStoreSnapshot,
  );
  const st = snapshot.status;
  const [upstreamDraft, setUpstreamDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterKind, setFilterKind] = useState<LlmProxyFilterKind>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [opencodeGo, setOpencodeGo] = useState<
    Pick<OpencodeGoProxyStatus, "enabled" | "running" | "claudeSettingsAligned"> | null
  >(null);
  const opencodeGoRunning = Boolean(opencodeGo?.enabled && opencodeGo?.running);

  useEffect(() => {
    void refreshClaudeLlmProxyStatus(repositoryPath);
    void getOpencodeGoProxyStatus()
      .then((ocgo) =>
        setOpencodeGo({
          enabled: ocgo.enabled,
          running: ocgo.running,
          claudeSettingsAligned: ocgo.claudeSettingsAligned,
        }),
      )
      .catch(() => setOpencodeGo(null));
  }, [repositoryPath]);

  useEffect(() => {
    if (!st) return;
    setUpstreamDraft(st.upstream || st.suggestedUpstream || "");
  }, [st?.listening, st?.running, st?.upstream, st?.suggestedUpstream]);

  const handleClear = useCallback(() => {
    void clearClaudeLlmProxyStore();
  }, []);

  const persistConfig = useCallback(
    async (listening: boolean, upstream: string) => {
      setSaving(true);
      try {
        await applyClaudeLlmProxyConfig(listening, upstream, repositoryPath);
        const ocgo = await getOpencodeGoProxyStatus().catch(() => null);
        setOpencodeGo(
          ocgo
            ? {
                enabled: ocgo.enabled,
                running: ocgo.running,
                claudeSettingsAligned: ocgo.claudeSettingsAligned,
              }
            : null,
        );
        if (!listening) {
          message.info("已关闭监听");
        }
      } catch (e) {
        message.error(typeof e === "string" ? e : "保存代理配置失败");
      } finally {
        setSaving(false);
      }
    },
    [repositoryPath],
  );

  const proxyConflict = useMemo(
    () =>
      resolveAnthropicProxyConflict(
        opencodeGo ?? { enabled: false, running: false, claudeSettingsAligned: false },
        st,
      ),
    [opencodeGo, st],
  );
  const proxyConflictMessage = anthropicProxyConflictMessage(proxyConflict);

  const handleListeningChange = useCallback(
    (checked: boolean) => {
      if (checked && opencodeGoRunning) {
        const msg = anthropicProxyConflictMessage(
          resolveAnthropicProxyConflict(
            opencodeGo ?? { enabled: true, running: true, claudeSettingsAligned: false },
            { listening: true, running: true },
          ),
        );
        if (msg) {
          message.warning(msg);
        }
      }
      void persistConfig(checked, upstreamDraft);
    },
    [persistConfig, upstreamDraft, opencodeGo, opencodeGoRunning],
  );

  const handleUpstreamBlur = useCallback(() => {
    if (!st?.listening) return;
    const current = (st.upstream || st.suggestedUpstream || "").trim();
    if (upstreamDraft.trim() === current.trim()) return;
    void persistConfig(true, upstreamDraft);
  }, [persistConfig, st, upstreamDraft]);

  const baseRecords = useMemo(
    () =>
      filterLlmProxyRecordsForDisplay(snapshot.records, {
        hideStreamJsonWhenProxyActive:
          snapshot.status?.listening === true && snapshot.status?.running === true,
      }),
    [snapshot.records, snapshot.status?.listening, snapshot.status?.running],
  );

  const visibleRecords = useMemo(
    () => filterLlmProxyRecordsByPanelQuery(baseRecords, { query: searchQuery, kind: filterKind }),
    [baseRecords, searchQuery, filterKind],
  );

  const summary = useMemo(() => summarizeLlmProxyRecords(visibleRecords), [visibleRecords]);

  const handleExport = useCallback(() => {
    if (visibleRecords.length === 0) return;
    const json = exportLlmProxyRecordsJson(visibleRecords);
    void navigator.clipboard.writeText(json).then(
      () => message.success(`已复制 ${visibleRecords.length} 条记录 JSON`),
      () => message.error("复制失败"),
    );
  }, [visibleRecords]);

  const items = useMemo(
    () =>
      visibleRecords.map((record) => ({
        key: record.id,
        label: <RecordSummary record={record} />,
        children: (
          <div className="app-llm-proxy-record__body">
            <HttpBodyJsonViewer
              title="请求主体 (Request Body)"
              rawContent={record.requestBodyPreview}
              byteCount={record.requestBytes}
              isTruncated={record.requestTruncated}
              defaultExpanded
              emptyHint={
                record.requestBytes === 0
                  ? `${record.method} 请求通常无请求体。`
                  : undefined
              }
            />
            <HttpBodyJsonViewer
              title="响应主体 (Response Body)"
              rawContent={record.responseBodyPreview}
              byteCount={record.responseBytes}
              isTruncated={record.responseTruncated}
              defaultExpanded={false}
              emptyHint={
                record.responseBytes === 0
                  ? `${record.method} 响应无正文或尚未返回。`
                  : undefined
              }
            />
            <div className="app-llm-proxy-record__footer">
              <GlobalOutlined style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)" }} />
              <span className="app-llm-proxy-record__upstream-text">
                {record.upstreamUrl?.trim()
                  ? `转发: ${record.upstreamUrl}`
                  : `上游: ${record.upstream}`}
              </span>
            </div>
          </div>
        ),
      })),
    [visibleRecords],
  );

  return (
    <div
      className={
        "app-llm-proxy-panel" +
        (variant === "popover" ? " app-llm-proxy-panel--popover" : "")
      }
    >
      <div className="app-llm-proxy-panel__toolbar">
        <div className="app-llm-proxy-panel__toolbar-head">
          <span className="app-llm-proxy-panel__title">LLM 代理</span>
          <div className="app-llm-proxy-panel__toolbar-actions">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              onClick={handleExport}
              disabled={visibleRecords.length === 0}
              className="app-llm-proxy-panel__export-btn"
            >
              导出
            </Button>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={handleClear}
              disabled={baseRecords.length === 0}
              className="app-llm-proxy-panel__clear-btn"
            >
              清空
            </Button>
          </div>
        </div>

        {proxyConflictMessage ? (
          <Alert
            type="warning"
            showIcon
            message="OpenCode 代理优先"
            description={proxyConflictMessage}
            style={{ marginBottom: 8 }}
          />
        ) : opencodeGoRunning ? (
          <Alert
            type="info"
            showIcon
            message="OpenCode 代理已运行"
            description="开启 LLM 监听后，Claude 子进程仍优先走 OpenCode 代理，Anthropic 请求不会记录在本面板。"
            style={{ marginBottom: 8 }}
          />
        ) : null}

        <div className="app-llm-proxy-panel__toolbar-body">
          <div className="app-llm-proxy-panel__config-row app-llm-proxy-panel__config-row--switch">
            <span className="app-llm-proxy-panel__route-label">监听</span>
            <div className="app-llm-proxy-panel__config-control">
              <Switch
                size="small"
                checked={st?.listening === true}
                loading={saving}
                onChange={handleListeningChange}
              />
              <span className="app-llm-proxy-panel__status-label">
                {st?.listening && st?.running ? (
                  <>
                    <span className="app-llm-proxy-panel__status-dot app-llm-proxy-panel__status-dot--active" />
                    监听中
                  </>
                ) : st?.listening ? (
                  "启动中…"
                ) : (
                  <>
                    <span className="app-llm-proxy-panel__status-dot" />
                    未监听
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="app-llm-proxy-panel__config-row">
            <span className="app-llm-proxy-panel__route-label">本地</span>
            <Input
              size="small"
              readOnly
              className="app-llm-proxy-panel__config-input"
              value={
                st?.localProxyUrl ??
                (st?.running && st.port != null
                  ? `http://127.0.0.1:${st.port}`
                  : "开启监听后分配")
              }
            />
          </div>
          <div className="app-llm-proxy-panel__config-row">
            <span className="app-llm-proxy-panel__route-label">上游</span>
            <Input
              size="small"
              className="app-llm-proxy-panel__config-input"
              placeholder={st?.suggestedUpstream || "https://api.anthropic.com"}
              value={upstreamDraft}
              disabled={saving}
              onChange={(e) => setUpstreamDraft(e.target.value)}
              onBlur={handleUpstreamBlur}
              onPressEnter={handleUpstreamBlur}
            />
          </div>
          {st?.listening ? (
            <p className="app-llm-proxy-panel__config-hint">
              修改上游或开关监听后，需新建 Claude 会话才会走代理。
            </p>
          ) : null}
        </div>

        {baseRecords.length > 0 ? (
          <div className="app-llm-proxy-panel__stats">
            <span className="app-llm-proxy-panel__stat" title="当前列表请求数">
              {summary.total} 条
            </span>
            <span className="app-llm-proxy-panel__stat" title="Messages API 请求">
              {summary.messagesCount} Messages
            </span>
            {summary.errorCount > 0 ? (
              <span className="app-llm-proxy-panel__stat app-llm-proxy-panel__stat--error">
                {summary.errorCount} 失败
              </span>
            ) : null}
            {summary.totalInputTokens + summary.totalOutputTokens > 0 ? (
              <span className="app-llm-proxy-panel__stat" title="从响应 usage 汇总（可见记录）">
                Token ↑{formatTokenCountShort(summary.totalInputTokens)} ↓
                {formatTokenCountShort(summary.totalOutputTokens)}
              </span>
            ) : null}
            {summary.avgDurationMs != null ? (
              <span className="app-llm-proxy-panel__stat" title="可见记录的平均总耗时">
                均耗时 {summary.avgDurationMs}ms
              </span>
            ) : null}
            {summary.avgTtftMs != null ? (
              <span className="app-llm-proxy-panel__stat" title="仅统计流式 Messages 的首 Token 延迟">
                流式均 TTFT {summary.avgTtftMs}ms
              </span>
            ) : null}
          </div>
        ) : null}

        {baseRecords.length > 0 ? (
          <div className="app-llm-proxy-panel__filters">
            <Input
              size="small"
              allowClear
              placeholder="搜索路径 / 模型 / 状态码"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="app-llm-proxy-panel__search-input"
            />
            <Segmented
              size="small"
              value={filterKind}
              onChange={(v) => setFilterKind(v as LlmProxyFilterKind)}
              options={[
                { label: "全部", value: "all" },
                { label: "Messages", value: "messages" },
                { label: "错误", value: "errors" },
              ]}
              className="app-llm-proxy-panel__filter-segmented"
            />
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="app-llm-proxy-panel__list-host">
          <Collapse
            size="small"
            className="app-llm-proxy-panel__list"
            items={items}
          />
        </div>
      ) : baseRecords.length > 0 && visibleRecords.length === 0 ? (
        <div className="app-llm-proxy-panel__empty-container app-llm-proxy-panel__empty-container--filter">
          <span className="app-llm-proxy-panel__empty-title">无匹配记录</span>
          <span className="app-llm-proxy-panel__empty-subtitle">
            调整筛选或搜索条件；当前共 {baseRecords.length} 条已捕获记录。
          </span>
        </div>
      ) : (
        <div className="app-llm-proxy-panel__empty-container">
          <div className="app-llm-proxy-empty-radar">
            <div className="app-llm-proxy-empty-radar__circle app-llm-proxy-empty-radar__circle--1" />
            <div className="app-llm-proxy-empty-radar__circle app-llm-proxy-empty-radar__circle--2" />
            <div className="app-llm-proxy-empty-radar__circle app-llm-proxy-empty-radar__circle--3" />
            <div className="app-llm-proxy-empty-radar__circle app-llm-proxy-empty-radar__circle--4" />
            <div className="app-llm-proxy-empty-radar__dot" />
          </div>

          <span className="app-llm-proxy-panel__empty-title">
            {st?.listening && st?.running ? (
              <>
                等待 LLM 流量
                <span className="app-llm-proxy-panel__pulse-dot" />
              </>
            ) : (
              "未开启监听"
            )}
          </span>

          <span className="app-llm-proxy-panel__empty-subtitle">
            {st?.listening
              ? "开启监听后新建会话并发送消息，HTTP 代理会捕获 API 请求/响应；若仍为空，将显示 stream-json 兜底记录。"
              : "打开上方「监听」开关并配置上游地址后，新建 Claude 会话即可开始捕获。"}
          </span>

          <div className="app-llm-proxy-panel__empty-tip">
            <span className="app-llm-proxy-panel__empty-tip-icon">💡</span>
            <span className="app-llm-proxy-panel__empty-tip-text">
              <strong>实时洞察：</strong>当前 AionUi 运行的一切模型请求（Prompt 输入、系统角色、工具调用与响应）都将经由此代理管道被捕获，方便您进行底层调试与审计。
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
