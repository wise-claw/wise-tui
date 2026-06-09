import { Alert, Button, Collapse, Input, Switch, message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DeleteOutlined,
  ThunderboltOutlined,
  FieldTimeOutlined,
  SwapOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import type { ClaudeLlmProxyRecord } from "../../services/claudeLlmProxy";
import {
  applyClaudeLlmProxyConfig,
  clearClaudeLlmProxyStore,
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  subscribeClaudeLlmProxyStore,
} from "../../stores/claudeLlmProxyStore";
import { getOpencodeGoProxyStatus } from "../../services/opencodeGoProxy";
import {
  anthropicProxyConflictMessage,
  resolveAnthropicProxyConflict,
} from "../../utils/anthropicProxyConflict";
import { filterLlmProxyRecordsForDisplay } from "../../utils/llmProxyTrafficDisplay";
import { resolveProxyTtftMs } from "../../utils/llmProxyTtft";
import { HttpBodyJsonViewer } from "./HttpBodyJsonViewer";
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

function RecordSummary({ record }: { record: ClaudeLlmProxyRecord }) {
  const isSuccess = record.statusCode != null && record.statusCode >= 200 && record.statusCode < 300;
  const isError = record.statusCode != null && record.statusCode >= 400;
  const ttftMs = resolveProxyTtftMs(record);

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
        {record.isStreaming ? (
          <span className="app-llm-proxy-record__stream-badge">流式</span>
        ) : null}

        <div className="app-llm-proxy-record__metrics">
          <span
            className="app-llm-proxy-record__metric-item"
            title={`传输大小: 输入 ${formatBytes(record.requestBytes)} / 输出 ${formatBytes(record.responseBytes)}`}
          >
            <SwapOutlined style={{ fontSize: 9, opacity: 0.6 }} />
            <span>{formatBytes(record.responseBytes || record.requestBytes)}</span>
          </span>

          <span className="app-llm-proxy-record__metric-item" title={`响应延迟: ${record.durationMs}ms`}>
            <ThunderboltOutlined style={{ fontSize: 9, color: "#eab308", opacity: 0.9 }} />
            <span>{record.durationMs}ms</span>
          </span>

          {ttftMs != null ? (
            <span
              className="app-llm-proxy-record__metric-item"
              title={`首 Token (TTFT): ${ttftMs}ms`}
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
  const [opencodeGoRunning, setOpencodeGoRunning] = useState(false);

  useEffect(() => {
    void refreshClaudeLlmProxyStatus(repositoryPath);
    void getOpencodeGoProxyStatus()
      .then((ocgo) => setOpencodeGoRunning(Boolean(ocgo.enabled && ocgo.running)))
      .catch(() => setOpencodeGoRunning(false));
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
        setOpencodeGoRunning(Boolean(ocgo?.enabled && ocgo?.running));
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
        opencodeGoRunning ? { enabled: true, running: true } : { enabled: false, running: false },
        st,
      ),
    [opencodeGoRunning, st],
  );
  const proxyConflictMessage = anthropicProxyConflictMessage(proxyConflict);

  const handleListeningChange = useCallback(
    (checked: boolean) => {
      if (checked && opencodeGoRunning) {
        const msg = anthropicProxyConflictMessage(
          resolveAnthropicProxyConflict(
            { enabled: true, running: true },
            { listening: true, running: true },
          ),
        );
        if (msg) {
          message.warning(msg);
        }
      }
      void persistConfig(checked, upstreamDraft);
    },
    [persistConfig, upstreamDraft, opencodeGoRunning],
  );

  const handleUpstreamBlur = useCallback(() => {
    if (!st?.listening) return;
    const current = (st.upstream || st.suggestedUpstream || "").trim();
    if (upstreamDraft.trim() === current.trim()) return;
    void persistConfig(true, upstreamDraft);
  }, [persistConfig, st, upstreamDraft]);

  const displayRecords = useMemo(
    () => filterLlmProxyRecordsForDisplay(snapshot.records),
    [snapshot.records],
  );

  const items = useMemo(
    () =>
      displayRecords.map((record) => ({
        key: record.id,
        label: <RecordSummary record={record} />,
        children: (
          <div className="app-llm-proxy-record__body">
            <HttpBodyJsonViewer
              title="请求主体 (Request Body)"
              rawContent={record.requestBodyPreview}
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
    [displayRecords],
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
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={handleClear}
            disabled={displayRecords.length === 0}
            className="app-llm-proxy-panel__clear-btn"
          >
            清空
          </Button>
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
      </div>

      {items.length > 0 ? (
        <Collapse
          size="small"
          className="app-llm-proxy-panel__list"
          items={items}
        />
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
