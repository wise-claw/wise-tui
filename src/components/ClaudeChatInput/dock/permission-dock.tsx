import { Button, Tag } from "antd";
import { useEffect, useRef } from "react";
import type { PermissionRequest } from "../../../types";
import type { ControlRequestStatus } from "../../../notifications";
import { ControlRequestStatusHint } from "./control-request-status";
import {
  DOCK_ACTION_ROW_STYLE,
  DOCK_SECONDARY_TEXT_STYLE,
  DOCK_SPACING,
  DOCK_TITLE_STYLE,
  PERMISSION_FILE_PATTERN_ITEM_STYLE,
  PERMISSION_FILE_PATTERN_LIST_STYLE,
} from "./shared-styles";

interface PermissionDockProps {
  request: PermissionRequest;
  requestStatus?: ControlRequestStatus | null;
  requestError?: string | null;
  responding?: boolean;
  onDecide: (response: "allow_once" | "allow_always" | "deny") => void;
}

function resolveAllowOnceButtonLabel(
  request: PermissionRequest,
  status?: ControlRequestStatus | null,
): string {
  if (request.tool === "ExitPlanMode") {
    if (status === "failed") return "重试：批准计划";
    if (status === "expired") return "重新批准计划";
    return "批准计划并继续";
  }
  if (status === "failed") return "重试允许一次";
  if (status === "expired") return "重新允许一次";
  return "允许一次";
}

function resolveAllowAlwaysButtonLabel(status?: ControlRequestStatus | null): string {
  if (status === "failed") return "重试始终允许";
  if (status === "expired") return "重新始终允许";
  return "始终允许";
}

export function PermissionDock({ request, requestStatus, requestError, responding, onDecide }: PermissionDockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isExitPlan = request.tool === "ExitPlanMode";
  const toolLabel = isExitPlan ? "退出规划模式" : request.tool;

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [request.id]);

  return (
    <div
      ref={rootRef}
      className={`app-claude-dock app-claude-dock--permission${isExitPlan ? " app-claude-dock--permission-exit-plan" : ""}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: DOCK_SPACING.compact }}>
        <Tag color={isExitPlan ? "processing" : "warning"} style={{ fontSize: 11 }}>
          {isExitPlan ? "计划确认" : "权限请求"}
        </Tag>
        <span style={DOCK_SECONDARY_TEXT_STYLE}>{toolLabel}</span>
      </div>
      <p style={{ ...DOCK_TITLE_STYLE, marginBottom: DOCK_SPACING.compact, fontWeight: isExitPlan ? 500 : 400 }}>
        {request.description}
      </p>
      {isExitPlan ? (
        <p style={{ ...DOCK_SECONDARY_TEXT_STYLE, marginBottom: DOCK_SPACING.compact }}>
          会话当前处于规划模式；批准后 Agent 将退出规划并开始执行。
        </p>
      ) : null}
      <ControlRequestStatusHint
        status={requestStatus}
        errorText={requestError}
        failedFallbackText="上次授权回复未送达，请重试。"
        expiredText="该授权请求已超时，如仍需处理请重新操作一次。"
        density="compact"
      />
      {request.filePatterns && request.filePatterns.length > 0 && (
        <div style={PERMISSION_FILE_PATTERN_LIST_STYLE}>
          {request.filePatterns.map((p) => (
            <code key={p} style={PERMISSION_FILE_PATTERN_ITEM_STYLE}>
              {p}
            </code>
          ))}
        </div>
      )}
      <div style={DOCK_ACTION_ROW_STYLE}>
        <Button size="small" danger disabled={responding} onClick={() => onDecide("deny")}>
          {isExitPlan ? "暂不执行" : "拒绝"}
        </Button>
        {!isExitPlan ? (
          <Button size="small" disabled={responding} onClick={() => onDecide("allow_once")}>
            {resolveAllowOnceButtonLabel(request, requestStatus)}
          </Button>
        ) : null}
        <Button
          size="small"
          type="primary"
          disabled={responding}
          onClick={() => onDecide(isExitPlan ? "allow_once" : "allow_always")}
        >
          {isExitPlan
            ? resolveAllowOnceButtonLabel(request, requestStatus)
            : resolveAllowAlwaysButtonLabel(requestStatus)}
        </Button>
      </div>
    </div>
  );
}
