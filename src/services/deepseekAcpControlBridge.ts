/**
 * Bridge DeepSeek Harness ACP control events into notificationHub so PermissionDock can
 * render without a third Modal stack.
 */
import { notificationHub } from "../notifications/hub";
import type { PermissionRequest } from "../types";
import {
  onDeepseekAcpPermissionRequest,
  type DeepseekAcpPermissionRequestPayload,
} from "./deepseekAcp";

function mapPermission(payload: DeepseekAcpPermissionRequestPayload): PermissionRequest {
  return {
    id: payload.requestId,
    tool: payload.toolName || "Tool",
    description: payload.description || "",
    controlSubtype: "permission",
  };
}

/** Start listening; returns a disposer. Safe to call once at app bootstrap. */
export async function startDeepseekAcpControlBridge(): Promise<() => void> {
  const unsubs = await Promise.all([
    onDeepseekAcpPermissionRequest((payload) => {
      const sid = payload.sessionId?.trim();
      if (!sid) return;
      notificationHub.setPermissionRequest(sid, mapPermission(payload));
    }),
  ]);
  return () => {
    for (const u of unsubs) u();
  };
}
