import type { ClaudeHostProcess, ClaudeSession } from "../types";
import { collectLiveHostPidsForClaudeSession } from "../utils/claudeHostRunningSessionIds";
import { cancelClaudeExecution } from "./claude";
import { killClaudeHostProcess } from "./systemResource";

/** 终止绑定主会话对应的 Claude 本机进程（优先会话 ID，否则按路径关联 PID）。 */
export async function stopClaudeMainSession(params: {
  session: ClaudeSession;
  claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  onCancelTabSession?: (tabSessionId: string) => void;
}): Promise<void> {
  const { session, claudeProcesses, onCancelTabSession } = params;
  const sid = session.claudeSessionId?.trim();
  if (sid) {
    await cancelClaudeExecution(sid);
    return;
  }
  const pids = collectLiveHostPidsForClaudeSession(session, claudeProcesses);
  if (pids.length > 0) {
    await Promise.all(pids.map((pid) => killClaudeHostProcess(pid)));
    return;
  }
  if (onCancelTabSession) {
    onCancelTabSession(session.id);
    return;
  }
  throw new Error("未找到可终止的本机进程");
}
