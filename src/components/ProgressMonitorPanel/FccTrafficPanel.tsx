import { DeleteOutlined, FieldTimeOutlined, GlobalOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Collapse, Input, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FCC_TRACES_PAGE_SIZE } from "../../constants/fccTraces";
import {
  clearFccTracesStore,
  getFccTracesStoreSnapshot,
  loadMoreFccTraces,
  startFccTracesPolling,
  stopFccTracesPolling,
  subscribeFccTracesStore,
} from "../../stores/fccTracesStore";
import type { FccTraceEntry } from "../../types/fccTrace";
import { HttpBodyJsonViewer, isHttpBodyTruncatedPreview } from "./HttpBodyJsonViewer";
import "./LlmProxyTrafficPanel.css";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

function RecordSummary({ record }: { record: FccTraceEntry }) {
  const isSuccess =
    record.statusCode != null && record.statusCode >= 200 && record.statusCode < 300;
  const isError = record.statusCode != null && record.statusCode >= 400;

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
  };

  const defaultColor = {
    bg: "var(--ant-color-fill-quaternary)",
    text: "var(--ant-color-text-secondary)",
    border: "var(--ant-color-border-secondary)",
  };

  const mStyle = methodColors[record.method.toUpperCase()] || defaultColor;
  const requestBytes = record.requestPreview?.length ?? 0;
  const responseBytes = record.responsePreview?.length ?? 0;

  return (
    <div className="app-llm-proxy-record__summary" onClick={(e) => e.stopPropagation()}>
      <div className="app-llm-proxy-record__summary-left">
        <span className="app-llm-proxy-record__time" title="请求发生时间">
          <FieldTimeOutlined style={{ marginRight: 3, opacity: 0.7 }} />
          {formatTime(record.timestampMs)}
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
        {record.model ? (
          <span className="app-llm-proxy-record__stream-badge" title="模型">
            {record.model}
          </span>
        ) : null}

        <div className="app-llm-proxy-record__metrics">
          <span
            className="app-llm-proxy-record__metric-item"
            title={`传输大小: 请求 ${formatBytes(requestBytes)} / 响应 ${formatBytes(responseBytes)}`}
          >
            <span>{formatBytes(responseBytes || requestBytes)}</span>
          </span>

          {record.durationMs != null ? (
            <span
              className="app-llm-proxy-record__metric-item"
              title={`响应延迟: ${record.durationMs}ms`}
            >
              <ThunderboltOutlined style={{ fontSize: 9, color: "#eab308", opacity: 0.9 }} />
              <span>{record.durationMs}ms</span>
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
  active?: boolean;
  variant?: "sidebar" | "popover";
}

/** 读取 `~/.fcc/traces/` 展示 Claude → FCC 的请求/响应摘要（对齐 LLM 代理面板）。 */
export function FccTrafficPanel({ active = true, variant = "sidebar" }: Props) {
  const snapshot = useSyncExternalStore(
    subscribeFccTracesStore,
    getFccTracesStoreSnapshot,
    getFccTracesStoreSnapshot,
  );
  const st = snapshot.status;
  const running = st?.serverRunning === true;
  const listHostRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(FCC_TRACES_PAGE_SIZE);

  useEffect(() => {
    if (!active) {
      stopFccTracesPolling();
      return;
    }
    startFccTracesPolling();
    return () => stopFccTracesPolling();
  }, [active]);

  useEffect(() => {
    if (snapshot.traces.length === 0) {
      setVisibleCount(FCC_TRACES_PAGE_SIZE);
    }
  }, [snapshot.traces.length]);

  const displayedTraces = useMemo(
    () => snapshot.traces.slice(0, visibleCount),
    [snapshot.traces, visibleCount],
  );

  const canRevealMoreLocally = visibleCount < snapshot.traces.length;
  const showListFooter =
    snapshot.traces.length > 0 &&
    (canRevealMoreLocally || snapshot.hasMore || snapshot.loadingMore);

  const handleListScroll = useCallback(() => {
    const el = listHostRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 56;
    if (!nearBottom) return;

    const snap = getFccTracesStoreSnapshot();
    setVisibleCount((c) => {
      if (c < snap.traces.length) {
        return Math.min(c + FCC_TRACES_PAGE_SIZE, snap.traces.length);
      }
      if (snap.hasMore && !snap.loadingMore) {
        void loadMoreFccTraces().then(() => {
          setVisibleCount((prev) =>
            Math.min(prev + FCC_TRACES_PAGE_SIZE, getFccTracesStoreSnapshot().traces.length),
          );
        });
      }
      return c;
    });
  }, []);

  const handleClear = useCallback(() => {
    void clearFccTracesStore()
      .then(() => {
        setVisibleCount(FCC_TRACES_PAGE_SIZE);
        message.success("已清空 FCC trace 文件");
      })
      .catch((e) => {
        message.error(typeof e === "string" ? e : "清空 trace 失败");
      });
  }, []);

  const items = useMemo(
    () =>
      displayedTraces.map((record) => ({
        key: record.id,
        label: <RecordSummary record={record} />,
        children: (
          <div className="app-llm-proxy-record__body">
            <HttpBodyJsonViewer
              title="Claude 请求 (Request Body)"
              rawContent={record.requestPreview ?? ""}
              isTruncated={isHttpBodyTruncatedPreview(record.requestPreview)}
              defaultExpanded
              emptyHint={
                !record.requestPreview?.trim()
                  ? `${record.method} 请求无正文或未写入 trace。`
                  : undefined
              }
            />
            <HttpBodyJsonViewer
              title="FCC 响应 (Response Body)"
              rawContent={record.responsePreview ?? ""}
              isTruncated={isHttpBodyTruncatedPreview(record.responsePreview)}
              defaultExpanded={false}
              emptyHint={
                !record.responsePreview?.trim()
                  ? `${record.method} 响应无正文或尚未返回。`
                  : undefined
              }
            />
            {record.upstreamPreview?.trim() ? (
              <HttpBodyJsonViewer
                title="FCC → 上游 (Upstream)"
                rawContent={record.upstreamPreview}
                isTruncated={isHttpBodyTruncatedPreview(record.upstreamPreview)}
                defaultExpanded={false}
              />
            ) : null}
            <div className="app-llm-proxy-record__footer">
              <GlobalOutlined style={{ fontSize: 10, color: "var(--ant-color-text-quaternary)" }} />
              <span className="app-llm-proxy-record__upstream-text">
                {record.sessionHint?.trim()
                  ? `会话: ${record.sessionHint}`
                  : record.anthropicRequestId?.trim()
                    ? `请求 ID: ${record.anthropicRequestId}`
                    : `代理: ${st?.proxyBaseUrl ?? "—"}`}
              </span>
            </div>
          </div>
        ),
      })),
    [displayedTraces, st?.proxyBaseUrl],
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
          <span className="app-llm-proxy-panel__title">FCC 请求</span>
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={handleClear}
            disabled={snapshot.traces.length === 0}
            className="app-llm-proxy-panel__clear-btn"
          >
            清空
          </Button>
        </div>

        <div className="app-llm-proxy-panel__toolbar-body">
          <div className="app-llm-proxy-panel__config-row app-llm-proxy-panel__config-row--switch">
            <span className="app-llm-proxy-panel__route-label">状态</span>
            <div className="app-llm-proxy-panel__config-control">
              <span className="app-llm-proxy-panel__status-label">
                {running ? (
                  <>
                    <span className="app-llm-proxy-panel__status-dot app-llm-proxy-panel__status-dot--active" />
                    运行中
                  </>
                ) : (
                  <>
                    <span className="app-llm-proxy-panel__status-dot" />
                    未运行
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
                st?.proxyBaseUrl?.trim() ||
                (running && st?.port ? `http://127.0.0.1:${st.port}` : "启动 FCC 后分配")
              }
            />
          </div>
          <div className="app-llm-proxy-panel__config-row">
            <span className="app-llm-proxy-panel__route-label">模型</span>
            <Input
              size="small"
              readOnly
              className="app-llm-proxy-panel__config-input"
              placeholder="在 Admin UI 配置"
              value={st?.model?.trim() || ""}
            />
          </div>
          {running ? (
            <p className="app-llm-proxy-panel__config-hint">
              Claude 经 FCC 代理发消息时，TRACE 会写入 `~/.fcc/logs/server.log`（及可选的 `~/.fcc/traces/`）并在此展示。
            </p>
          ) : null}
        </div>
      </div>

      {items.length > 0 ? (
        <div
          ref={listHostRef}
          className="app-llm-proxy-panel__list-host"
          onScroll={handleListScroll}
        >
          <Collapse size="small" className="app-llm-proxy-panel__list" items={items} />
          {showListFooter ? (
            <div className="app-llm-proxy-panel__list-footer">
              {snapshot.loadingMore ? (
                <span>加载更早记录…</span>
              ) : canRevealMoreLocally || snapshot.hasMore ? (
                <span>
                  已显示 {displayedTraces.length}
                  {snapshot.traces.length > displayedTraces.length
                    ? ` / ${snapshot.traces.length}`
                    : ""}{" "}
                  条 · 继续向下滚动加载
                </span>
              ) : (
                <span>共 {snapshot.traces.length} 条</span>
              )}
            </div>
          ) : null}
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
            {running ? (
              <>
                等待 FCC 请求
                <span className="app-llm-proxy-panel__pulse-dot" />
              </>
            ) : (
              "FCC 未运行"
            )}
          </span>

          <span className="app-llm-proxy-panel__empty-subtitle">
            {running
              ? "请确认 Claude settings 已对齐 FCC，并在会话中发送消息；`server.log` 出现 TRACE 后会自动刷新（流式响应仅展示元数据摘要）。"
              : "请先在 FCC 服务入口启动 Free Claude Code，并确保 Claude 使用 FCC 作为 ANTHROPIC_BASE_URL。"}
          </span>
        </div>
      )}
    </div>
  );
}
