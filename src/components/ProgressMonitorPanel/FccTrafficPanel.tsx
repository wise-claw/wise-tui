import {
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FieldTimeOutlined,
  GlobalOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Collapse, Input, message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clearFccTracesStore,
  getFccTracesStoreSnapshot,
  startFccTracesPolling,
  stopFccTracesPolling,
  subscribeFccTracesStore,
} from "../../stores/fccTracesStore";
import type { FccTraceEntry } from "../../types/fccTrace";
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

function tryPrettyJson(raw: string): string {
  const t = raw.trim();
  if (!t) return raw;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return raw;
  }
}

function isTruncatedPreview(raw: string | null | undefined): boolean {
  return Boolean(raw?.includes("…[truncated]"));
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

interface JSONViewerProps {
  title: string;
  rawContent: string;
  isTruncated?: boolean;
  defaultExpanded?: boolean;
  emptyHint?: string;
}

function JSONViewer({
  title,
  rawContent,
  isTruncated,
  defaultExpanded = true,
  emptyHint,
}: JSONViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const prettyJson = useMemo(() => tryPrettyJson(rawContent), [rawContent]);
  const hasBody = prettyJson.trim().length > 0;

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(prettyJson).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [prettyJson],
  );

  const toggleExpanded = useCallback(() => {
    if (!hasBody) return;
    setExpanded((prev) => !prev);
  }, [hasBody]);

  return (
    <div
      className={
        "app-llm-proxy-json-viewer" +
        (expanded ? "" : " app-llm-proxy-json-viewer--collapsed")
      }
    >
      <div
        className={
          "app-llm-proxy-json-viewer__header" +
          (hasBody ? " app-llm-proxy-json-viewer__header--toggle" : "")
        }
        role={hasBody ? "button" : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        onClick={hasBody ? toggleExpanded : undefined}
        onKeyDown={
          hasBody
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpanded();
                }
              }
            : undefined
        }
      >
        <div className="app-llm-proxy-json-viewer__title-group">
          {hasBody ? (
            <span className="app-llm-proxy-json-viewer__chevron" aria-hidden>
              {expanded ? <DownOutlined /> : <RightOutlined />}
            </span>
          ) : null}
          <span className="app-llm-proxy-json-viewer__title">{title}</span>
          {isTruncated ? (
            <span className="app-llm-proxy-json-viewer__badge app-llm-proxy-json-viewer__badge--warning">
              已截断
            </span>
          ) : (
            <span className="app-llm-proxy-json-viewer__badge">JSON</span>
          )}
          {!expanded && hasBody ? (
            <span className="app-llm-proxy-json-viewer__size-hint">
              {formatBytes(prettyJson.length)}
            </span>
          ) : null}
        </div>
        <Button
          size="small"
          type="text"
          icon={
            copied ? (
              <CheckOutlined style={{ color: "var(--ant-color-success)" }} />
            ) : (
              <CopyOutlined />
            )
          }
          onClick={handleCopy}
          className="app-llm-proxy-json-viewer__copy-btn"
          disabled={!hasBody}
        >
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      {expanded ? (
        hasBody ? (
          <div className="app-llm-proxy-json-viewer__code-wrapper">
            <pre className="app-llm-proxy-json-viewer__code">{prettyJson}</pre>
          </div>
        ) : emptyHint ? (
          <p className="app-llm-proxy-json-viewer__empty-hint">{emptyHint}</p>
        ) : null
      ) : null}
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

  useEffect(() => {
    if (!active) {
      stopFccTracesPolling();
      return;
    }
    startFccTracesPolling();
    return () => stopFccTracesPolling();
  }, [active]);

  const handleClear = useCallback(() => {
    void clearFccTracesStore()
      .then(() => message.success("已清空 FCC trace 文件"))
      .catch((e) => {
        message.error(typeof e === "string" ? e : "清空 trace 失败");
      });
  }, []);

  const items = useMemo(
    () =>
      snapshot.traces.map((record) => ({
        key: record.id,
        label: <RecordSummary record={record} />,
        children: (
          <div className="app-llm-proxy-record__body">
            <JSONViewer
              title="Claude 请求 (Request Body)"
              rawContent={record.requestPreview ?? ""}
              isTruncated={isTruncatedPreview(record.requestPreview)}
              defaultExpanded
              emptyHint={
                !record.requestPreview?.trim()
                  ? `${record.method} 请求无正文或未写入 trace。`
                  : undefined
              }
            />
            <JSONViewer
              title="FCC 响应 (Response Body)"
              rawContent={record.responsePreview ?? ""}
              isTruncated={isTruncatedPreview(record.responsePreview)}
              defaultExpanded={false}
              emptyHint={
                !record.responsePreview?.trim()
                  ? `${record.method} 响应无正文或尚未返回。`
                  : undefined
              }
            />
            {record.upstreamPreview?.trim() ? (
              <JSONViewer
                title="FCC → 上游 (Upstream)"
                rawContent={record.upstreamPreview}
                isTruncated={isTruncatedPreview(record.upstreamPreview)}
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
    [snapshot.traces, st?.proxyBaseUrl],
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
              Claude 经 FCC 代理发消息时，请求/响应会写入 `~/.fcc/traces/` 并在此展示。
            </p>
          ) : null}
        </div>
      </div>

      {items.length > 0 ? (
        <Collapse size="small" className="app-llm-proxy-panel__list" items={items} />
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
              ? "请确认 Claude settings 已对齐 FCC，并在会话中发送消息；trace 文件出现后会自动刷新。"
              : "请先在「服务」页启动 Free Claude Code，并确保 Claude 使用 FCC 作为 ANTHROPIC_BASE_URL。"}
          </span>
        </div>
      )}
    </div>
  );
}
