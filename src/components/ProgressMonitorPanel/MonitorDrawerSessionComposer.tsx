import { message } from "antd";
import { ComposerRegion } from "../ClaudeChatInput/composer-region";
import { useCallback, useEffect } from "react";
import type { ClaudeSession } from "../../types";

export type MonitorDrawerResumeSessionInput = {
  sessionId: string;
  prompt: string;
  repositoryPath?: string;
  repositoryDisplayName?: string;
  /** 执行环境派发任务标签，用于 worker 标签漂移后的回退匹配 */
  taskLabel?: string;
};

export type MonitorDrawerResumeSessionFn = (
  input: MonitorDrawerResumeSessionInput,
) => boolean | void | Promise<boolean | void>;

/** 监控抽屉打开前：从 tabs / 磁盘回退解析 worker 标签并 materialize 到内存 */
export type MonitorDrawerPrepareSessionFn = (
  input: Omit<MonitorDrawerResumeSessionInput, "prompt">,
) => Promise<ClaudeSession | null>;

export function MonitorDrawerSessionComposer({
  session,
  onResumeSession,
  disabledReason,
  resumeContext,
}: {
  session: ClaudeSession | null | undefined;
  onResumeSession?: MonitorDrawerResumeSessionFn;
  disabledReason?: string | null;
  resumeContext?: Omit<MonitorDrawerResumeSessionInput, "prompt" | "sessionId"> & {
    sessionId?: string;
  };
}) {

  const sessionId = resumeContext?.sessionId?.trim() || session?.id?.trim() || "";
  const blocked = Boolean(disabledReason?.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const editor = document.querySelector<HTMLElement>(
        ".app-monitor-panel__drawer-composer .app-claude-semi-chat-input-wrap .tiptap",
      );
      editor?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  const handleSend = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !sessionId || !onResumeSession || blocked) return;
    try {
      const ok = await Promise.resolve(
        onResumeSession({
          sessionId,
          prompt: trimmed,
          repositoryPath: resumeContext?.repositoryPath ?? session?.repositoryPath,
          repositoryDisplayName: resumeContext?.repositoryDisplayName ?? session?.repositoryName,
          taskLabel: resumeContext?.taskLabel,
        }),
      );
      if (ok === false) {
        message.warning("未能发送，请确认会话仍可用或稍后再试");
        return;
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    }
  }, [
    blocked,
    onResumeSession,
    resumeContext?.repositoryDisplayName,
    resumeContext?.repositoryPath,
    resumeContext?.taskLabel,
    session?.repositoryName,
    session?.repositoryPath,
    sessionId,
  ]);

  if (!onResumeSession) return null;

  return (
    <div className="app-monitor-panel__drawer-composer">
      <ComposerRegion
        session={(session ?? { id: sessionId, claudeSessionId: sessionId, repositoryPath: resumeContext?.repositoryPath ?? "", repositoryName: resumeContext?.repositoryDisplayName ?? "", model: "", status: "idle", messages: [], createdAt: Date.now(), pendingPrompt: "" }) as ClaudeSession}
        gitRepositoryPath={resumeContext?.repositoryPath}
        onExecute={(_id, prompt) => void handleSend(prompt)}
        onSessionModelChange={() => undefined}
        onCancel={() => undefined}
        todos={[]}
        questionRequest={null}
        permissionRequest={null}
        followupItems={[]}
        revertItems={[]}
        respondQuestionAt={() => undefined}
        dismissQuestionAt={() => undefined}
        onRespondToPermission={() => undefined}
        onSendFollowup={() => undefined}
        onRestoreRevert={() => undefined}
        compactFooterChrome
      />
      <div className="app-monitor-panel__drawer-composer-actions">
        <span className="app-monitor-panel__drawer-composer-hint">Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}
