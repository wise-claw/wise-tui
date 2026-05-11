import { CopyOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useState } from "react";
import { LinkifiedPre } from "../ClaudeSessions/LinkifiedPre";
import { SystemMessageContent } from "../ClaudeSessions/SystemMessageContent";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";

interface Props {
  log: SplitRuntimeLogItem;
  retryingPhase: SplitRetryPhase | null;
  onRetryStage: (phase: SplitRetryPhase) => void;
}

export function SplitRuntimeMessageRow({ log, retryingPhase, onRetryStage }: Props) {
  const [copied, setCopied] = useState(false);
  const bubbleRole: "user" | "assistant" | "system" =
    log.role === "user" ? "user" : log.role === "assistant" ? "assistant" : "system";
  const sender =
    log.role === "user"
      ? "我"
      : log.role === "assistant"
        ? "Claude"
        : log.role === "error"
          ? "错误"
          : "系统";
  const avatarLetter =
    log.role === "user" ? "我" : log.role === "assistant" ? "C" : log.role === "error" ? "!" : "S";
  const timeStr = new Date(log.at).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const isStageStartMessage = log.role === "system" && /^开始执行阶段\d+/.test(log.text.trim());
  const rowClass = [
    "app-claude-message",
    `app-claude-message--${bubbleRole}`,
    log.role === "error" ? "app-prd-task-panel__split-runtime-msg--error" : "",
    isStageStartMessage ? "app-prd-task-panel__split-runtime-msg--stage-running" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const copyText = useCallback(async () => {
    const content = log.text ?? "";
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
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
        window.setTimeout(() => setCopied(false), 1400);
      }
    }
  }, [log.text]);
  const canRetry = Boolean(log.retryPhase);
  const retryBusy = canRetry && retryingPhase === log.retryPhase;

  return (
    <div className={rowClass}>
      <div className="app-claude-message-avatar">{avatarLetter}</div>
      <div className="app-claude-message-body">
        <div className="app-claude-message-header">
          <span className="app-claude-message-sender">{sender}</span>
          <button
            type="button"
            className={`app-prd-task-panel__split-runtime-copy-btn ${copied ? "is-copied" : ""}`}
            onClick={() => void copyText()}
            aria-label="复制该条处理信息"
            title={copied ? "已复制" : "复制"}
          >
            <CopyOutlined />
            <span>{copied ? "已复制" : "复制"}</span>
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
        <div className="app-claude-message-content">
          {bubbleRole === "system" ? (
            <SystemMessageContent text={log.text} />
          ) : (
            <LinkifiedPre text={log.text} className="app-claude-message-text" />
          )}
        </div>
      </div>
    </div>
  );
}
