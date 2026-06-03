import { CopyOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinkifiedPre } from "../ClaudeSessions/LinkifiedPre";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";

interface Props {
  log: SplitRuntimeLogItem;
  retryingPhase: SplitRetryPhase | null;
  onRetryStage: (phase: SplitRetryPhase) => void;
}

export function SplitRuntimeMessageRow({ log, retryingPhase, onRetryStage }: Props) {
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );
  const scope = log.scope ?? (log.role === "assistant" ? "subagent" : "main");
  const status = log.status ?? (log.role === "error" ? "failed" : "info");
  const agentName = log.agentName ?? (scope === "subagent" ? "trellis-splitter" : "主会话");
  const timeStr = new Date(log.at).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const rowClass = [
    "app-claude-message",
    scope === "subagent" ? "app-claude-message--assistant" : "app-claude-message--system",
    "app-prd-task-panel__runtime-chat-row",
    `app-prd-task-panel__runtime-chat-row--${scope}`,
    `app-prd-task-panel__runtime-chat-row--${status}`,
    log.role === "error" ? "app-prd-task-panel__split-runtime-msg--error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const copyText = useCallback(async () => {
    const detailText = (log.details ?? [])
      .map((detail) => `${detail.label}: ${detail.value}`)
      .join("\n");
    const content = [log.title, log.text, detailText].filter(Boolean).join("\n");
    if (!content.trim()) return;
    const scheduleCopyReset = () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopied(false);
      }, 1400);
    };
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      scheduleCopyReset();
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setCopied(true);
        scheduleCopyReset();
      }
    }
  }, [log.details, log.text, log.title]);
  const canRetry = Boolean(log.retryPhase);
  const retryBusy = canRetry && retryingPhase === log.retryPhase;

  return (
    <div className={rowClass}>
      <div className="app-claude-message-avatar">{scope === "subagent" ? "S" : "M"}</div>
      <div className="app-claude-message-body">
        <div className="app-claude-message-header">
          <span className="app-claude-message-sender">{agentName}</span>
          <span className={`app-prd-task-panel__runtime-status app-prd-task-panel__runtime-status--${status}`}>
            {runtimeStatusLabel(status)}
          </span>
          <button
            type="button"
            className={`app-prd-task-panel__split-runtime-copy-btn ${copied ? "is-copied" : ""}`}
            onClick={() => void copyText()}
            aria-label="复制该条对话"
            title={copied ? "已复制" : "复制"}
          >
            <CopyOutlined />
          </button>
          {canRetry ? (
            <Button
              size="small"
              type="default"
              className="app-prd-task-panel__split-runtime-retry-btn"
              onClick={() => log.retryPhase && onRetryStage(log.retryPhase)}
              loading={retryBusy}
            >
              重试{log.retryPhase === "phase1" ? "阶段1" : "阶段2"}
            </Button>
          ) : null}
          <span className="app-claude-message-time">{timeStr}</span>
        </div>
        <div className="app-claude-message-content app-prd-task-panel__runtime-chat-content">
          {log.title || log.clusterId ? (
            <div className="app-prd-task-panel__runtime-chat-title">
              {log.title ? <span>{log.title}</span> : null}
              {log.clusterId ? <code>{log.clusterId}</code> : null}
            </div>
          ) : null}
          <LinkifiedPre text={log.text} className="app-claude-message-text app-prd-task-panel__runtime-chat-text" />
          {log.details?.length ? (
            <details className="app-prd-task-panel__runtime-chat-details">
              <summary>详情</summary>
              {log.details.map((detail, index) => (
                <div key={`${detail.label}-${index}`} className="app-prd-task-panel__runtime-chat-detail">
                  <span>{detail.label}</span>
                  <code>{detail.value}</code>
                </div>
              ))}
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function runtimeStatusLabel(status: SplitRuntimeLogItem["status"]): string {
  switch (status) {
    case "queued":
      return "等待";
    case "running":
      return "运行中";
    case "succeeded":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已中断";
    case "info":
    default:
      return "记录";
  }
}
