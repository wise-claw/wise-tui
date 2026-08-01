import { useEffect } from "react";
import { ensureCodexApprovalListening } from "../../stores/codexApprovalStore";

/**
 * App 级引导：确保 Codex RPC 审批事件在 Composer 未挂载前也已订阅。
 * 实际 UI 在 Composer 输入区上方的 `CodexApprovalDock`（对齐 AskUserQuestion）。
 */
export function CodexApprovalOverlay() {
  useEffect(() => {
    ensureCodexApprovalListening();
  }, []);
  return null;
}
