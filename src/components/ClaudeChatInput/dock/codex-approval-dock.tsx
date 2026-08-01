import { Button, Tag } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexApprovalRequestPayload } from "../../../services/codexRpc";
import type { CodexApprovalDecision } from "../../../hooks/useCodexApprovalPending";
import {
  DOCK_ACTION_ROW_STYLE,
  DOCK_SECONDARY_TEXT_STYLE,
  DOCK_SPACING,
  DOCK_TITLE_STYLE,
} from "./shared-styles";

interface CodexApprovalDockProps {
  request: CodexApprovalRequestPayload;
  onDecide: (decision: CodexApprovalDecision) => void | Promise<void>;
}

const DECISION_ORDER: CodexApprovalDecision[] = [
  "decline",
  "acceptForSession",
  "accept",
  "cancel",
];

const DECISION_LABEL: Record<CodexApprovalDecision, string> = {
  decline: "拒绝",
  acceptForSession: "本次会话全部允许",
  accept: "允许",
  cancel: "取消",
};

function normalizeAvailableDecisions(raw: string[] | undefined): CodexApprovalDecision[] {
  const allowed = new Set<string>(["accept", "acceptForSession", "decline", "cancel"]);
  const fromServer = Array.isArray(raw)
    ? raw.filter((d): d is CodexApprovalDecision => typeof d === "string" && allowed.has(d))
    : [];
  if (fromServer.length === 0) {
    return ["decline", "acceptForSession", "accept"];
  }
  return DECISION_ORDER.filter((d) => fromServer.includes(d));
}

function resolveTitle(request: CodexApprovalRequestPayload): string {
  if (request.type === "commandExecution") return "命令执行审批";
  if (request.type === "fileChange") return "文件变更审批";
  return "审批请求";
}

/**
 * Codex RPC 审批坞栏：放在 Composer 输入区上方，视觉与交互对齐 PermissionDock / AskUserQuestion。
 */
export function CodexApprovalDock({ request, onDecide }: CodexApprovalDockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [responding, setResponding] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const decisions = useMemo(
    () => normalizeAvailableDecisions(request.available_decisions),
    [request.available_decisions],
  );

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [request.request_id]);

  useEffect(() => {
    setResponding(false);
    setErrorText(null);
  }, [request.request_id]);

  const handleDecide = async (decision: CodexApprovalDecision) => {
    if (responding) return;
    setResponding(true);
    setErrorText(null);
    try {
      await onDecide(decision);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
      setResponding(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="app-claude-dock app-claude-dock--permission app-claude-dock--codex-approval"
      data-codex-approval-type={request.type}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: DOCK_SPACING.compact }}>
        <Tag color="warning" style={{ fontSize: 11 }}>
          Codex 审批
        </Tag>
        <span style={DOCK_SECONDARY_TEXT_STYLE}>{resolveTitle(request)}</span>
      </div>

      {request.type === "commandExecution" ? (
        <>
          {request.reason ? (
            <p style={{ ...DOCK_TITLE_STYLE, marginBottom: DOCK_SPACING.compact }}>{request.reason}</p>
          ) : null}
          <p style={{ ...DOCK_SECONDARY_TEXT_STYLE, marginBottom: DOCK_SPACING.tight }}>命令</p>
          <pre className="app-claude-dock--codex-approval__command">
            <code>{request.command?.trim() || "（空命令）"}</code>
          </pre>
          {request.cwd ? (
            <p style={{ ...DOCK_SECONDARY_TEXT_STYLE, marginTop: DOCK_SPACING.compact }}>
              工作目录：<code>{request.cwd}</code>
            </p>
          ) : null}
        </>
      ) : null}

      {request.type === "fileChange" ? (
        <p style={{ ...DOCK_TITLE_STYLE, marginBottom: DOCK_SPACING.compact }}>
          {request.reason?.trim() || "Codex 请求批准文件变更。"}
        </p>
      ) : null}

      {request.type === "unknown" ? (
        <p style={{ ...DOCK_TITLE_STYLE, marginBottom: DOCK_SPACING.compact }}>
          服务器发起了一个未知类型的审批请求
          {request.method ? `（${request.method}）` : ""}。
        </p>
      ) : null}

      {errorText ? (
        <p style={{ ...DOCK_SECONDARY_TEXT_STYLE, color: "var(--ant-color-error)", marginBottom: DOCK_SPACING.compact }}>
          回复失败：{errorText}
        </p>
      ) : null}

      <div style={DOCK_ACTION_ROW_STYLE}>
        {decisions.map((decision) => {
          const danger = decision === "decline" || decision === "cancel";
          const primary = decision === "accept";
          return (
            <Button
              key={decision}
              size="small"
              danger={danger}
              type={primary ? "primary" : "default"}
              disabled={responding}
              loading={responding && primary}
              onClick={() => void handleDecide(decision)}
            >
              {DECISION_LABEL[decision]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
