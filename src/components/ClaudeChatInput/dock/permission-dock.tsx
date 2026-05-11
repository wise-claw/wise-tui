import { Button, Tag } from "antd";
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

function resolveAllowOnceButtonLabel(status?: ControlRequestStatus | null): string {
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
  return (
    <div className="app-claude-dock app-claude-dock--permission">
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: DOCK_SPACING.compact }}>
        <Tag color="warning" style={{ fontSize: 11 }}>权限请求</Tag>
        <span style={DOCK_SECONDARY_TEXT_STYLE}>{request.tool}</span>
      </div>
      <p style={{ ...DOCK_TITLE_STYLE, marginBottom: DOCK_SPACING.compact, fontWeight: 400 }}>{request.description}</p>
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
        <Button size="small" danger disabled={responding} onClick={() => onDecide("deny")}>拒绝</Button>
        <Button size="small" disabled={responding} onClick={() => onDecide("allow_once")}>
          {resolveAllowOnceButtonLabel(requestStatus)}
        </Button>
        <Button size="small" type="primary" disabled={responding} onClick={() => onDecide("allow_always")}>
          {resolveAllowAlwaysButtonLabel(requestStatus)}
        </Button>
      </div>
    </div>
  );
}
