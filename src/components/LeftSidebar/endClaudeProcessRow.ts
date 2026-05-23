import { cancelClaudeExecution } from "../../services/claude";
import { killClaudeHostProcess } from "../../services/systemResource";
import type { ClaudeSession } from "../../types";
import { parseHostProcessDrawerPid, parseRegistryOrphanClaudeSid } from "./systemSessions";

/** 结束进程弹窗中单条行（Wise 标签 / 注册表孤儿 / 系统扫描 PID）。 */
export async function endClaudeProcessRow(params: {
  rowSessionId: string;
  rowSession?: ClaudeSession;
  onCancelTabSession?: (sessionId: string) => void;
}): Promise<void> {
  const { rowSessionId, rowSession, onCancelTabSession } = params;
  const orphanSid = parseRegistryOrphanClaudeSid(rowSessionId);
  const hostPid = parseHostProcessDrawerPid(rowSessionId);
  if (orphanSid) {
    await cancelClaudeExecution(orphanSid);
    return;
  }
  if (hostPid != null) {
    const sid = rowSession?.claudeSessionId?.trim();
    if (sid) {
      await cancelClaudeExecution(sid);
    } else {
      await killClaudeHostProcess(hostPid);
    }
    return;
  }
  if (onCancelTabSession) {
    onCancelTabSession(rowSessionId);
    return;
  }
  throw new Error("无法结束该进程");
}
