import { DeleteOutlined, FieldTimeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Collapse, message } from "antd";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  clearOpencodeGoProxyTracesStore,
  getOpencodeGoProxyTracesStoreSnapshot,
  refreshOpencodeGoProxyTracesStoreNow,
  startOpencodeGoProxyTracesPolling,
  stopOpencodeGoProxyTracesPolling,
  subscribeOpencodeGoProxyTracesStore,
} from "../../stores/opencodeGoProxyTracesStore";
import type { OpencodeGoProxyTraceEntry } from "../../types/opencodeGoProxyTrace";
import { HttpBodyJsonViewer, isHttpBodyTruncatedPreview } from "./HttpBodyJsonViewer";
import "./LlmProxyTrafficPanel.css";

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

function RecordSummary({ record }: { record: OpencodeGoProxyTraceEntry }) {
  const isSuccess =
    record.statusCode != null && record.statusCode >= 200 && record.statusCode < 300;
  const isError = record.statusCode != null && record.statusCode >= 400;

  return (
    <div className="app-llm-proxy-record__summary" onClick={(e) => e.stopPropagation()}>
      <div className="app-llm-proxy-record__summary-left">
        <span className="app-llm-proxy-record__time" title="请求时间">
          <FieldTimeOutlined style={{ marginRight: 3, opacity: 0.7 }} />
          {formatTime(record.timestampMs)}
        </span>
        <span className="app-llm-proxy-record__method-badge">{record.method}</span>
        <span className="app-llm-proxy-record__path-wrapper" title={record.path}>
          {record.path}
        </span>
      </div>
      <div className="app-llm-proxy-record__summary-right">
        {record.claudeModel && record.claudeModel !== record.upstreamModel ? (
          <span className="app-llm-proxy-record__stream-badge" title="客户端模型">
            {record.claudeModel}
          </span>
        ) : null}
        <span className="app-llm-proxy-record__stream-badge" title="上游模型">
          → {record.upstreamModel}
        </span>
        <div className="app-llm-proxy-record__metrics">
          <span className="app-llm-proxy-record__metric-item" title="耗时">
            <ThunderboltOutlined style={{ fontSize: 9, color: "#eab308", opacity: 0.9 }} />
            <span>{record.durationMs}ms</span>
          </span>
          {record.isStreaming ? (
            <span className="app-llm-proxy-record__stream-badge">流式</span>
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
}

/** OpenCode 内置代理请求 trace（Claude → Wise 代理 → OpenCode）。 */
export function OpencodeGoProxyTrafficPanel({ active = true }: Props) {
  const snapshot = useSyncExternalStore(
    subscribeOpencodeGoProxyTracesStore,
    getOpencodeGoProxyTracesStoreSnapshot,
    getOpencodeGoProxyTracesStoreSnapshot,
  );

  useEffect(() => {
    if (!active) {
      stopOpencodeGoProxyTracesPolling();
      return;
    }
    startOpencodeGoProxyTracesPolling();
    return () => stopOpencodeGoProxyTracesPolling();
  }, [active]);

  const handleClear = useCallback(() => {
    void clearOpencodeGoProxyTracesStore().catch((e) => {
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
            <div className="app-llm-proxy-record__detail-meta">
              Claude 模型：{record.claudeModel}
            </div>
            <div className="app-llm-proxy-record__detail-meta">
              上游：{record.upstreamUrl}
            </div>
            {record.errorMessage ? (
              <div className="app-llm-proxy-record__detail-meta app-llm-proxy-record__detail-meta--error">
                {record.errorMessage}
              </div>
            ) : null}
            <HttpBodyJsonViewer
              title="请求体"
              rawContent={record.requestPreview ?? ""}
              isTruncated={isHttpBodyTruncatedPreview(record.requestPreview)}
              defaultExpanded
              emptyHint="无请求体预览"
            />
            <HttpBodyJsonViewer
              title="响应摘要"
              rawContent={record.responsePreview ?? ""}
              isTruncated={isHttpBodyTruncatedPreview(record.responsePreview)}
              defaultExpanded={false}
              emptyHint={
                record.isStreaming && !record.responsePreview?.trim()
                  ? "流式响应尚未结束或无预览。"
                  : "无响应预览"
              }
            />
          </div>
        ),
      })),
    [snapshot.traces],
  );

  return (
    <div className="app-llm-proxy-traffic" aria-label="OpenCode 代理流量">
      <div className="app-llm-proxy-traffic__toolbar">
        <span className="app-llm-proxy-traffic__toolbar-meta">
          {snapshot.running ? "代理运行中" : "代理未运行"}
          {snapshot.traces.length > 0 ? ` · ${snapshot.traces.length} 条` : ""}
        </span>
        <span className="app-llm-proxy-traffic__toolbar-actions">
          <Button
            type="link"
            size="small"
            disabled={snapshot.loading}
            onClick={() => void refreshOpencodeGoProxyTracesStoreNow()}
          >
            刷新
          </Button>
          <Button
            type="link"
            size="small"
            danger
            disabled={snapshot.traces.length === 0}
            icon={<DeleteOutlined />}
            onClick={handleClear}
          >
            清空
          </Button>
        </span>
      </div>
      {snapshot.traces.length === 0 ? (
        <p className="app-llm-proxy-traffic__empty">
          {snapshot.running
            ? "暂无请求记录；在 Claude 会话中发起对话后会出现在这里。"
            : "请先启动 OpenCode 代理。"}
        </p>
      ) : (
        <Collapse
          className="app-llm-proxy-traffic__list"
          items={items}
          bordered={false}
          size="small"
        />
      )}
    </div>
  );
}
