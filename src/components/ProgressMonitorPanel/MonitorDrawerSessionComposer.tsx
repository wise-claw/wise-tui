import { SendOutlined } from "@ant-design/icons";
import { Button, Input, message } from "antd";
import { useCallback, useState } from "react";
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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const sessionId = resumeContext?.sessionId?.trim() || session?.id?.trim() || "";
  const blocked = Boolean(disabledReason?.trim());
  const canSend = Boolean(onResumeSession && sessionId && draft.trim() && !blocked);

  const handleSend = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || !sessionId || !onResumeSession || blocked) return;
    setSending(true);
    try {
      const ok = await Promise.resolve(
        onResumeSession({
          sessionId,
          prompt,
          repositoryPath: resumeContext?.repositoryPath ?? session?.repositoryPath,
          repositoryDisplayName: resumeContext?.repositoryDisplayName ?? session?.repositoryName,
          taskLabel: resumeContext?.taskLabel,
        }),
      );
      if (ok === false) {
        message.warning("未能发送，请确认会话仍可用或稍后再试");
        return;
      }
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [
    blocked,
    draft,
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
      <Input.TextArea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={disabledReason?.trim() || "输入消息以继续该会话…"}
        disabled={blocked || sending}
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPressEnter={(event) => {
          if (event.shiftKey) return;
          event.preventDefault();
          if (canSend) void handleSend();
        }}
      />
      <div className="app-monitor-panel__drawer-composer-actions">
        <span className="app-monitor-panel__drawer-composer-hint">Enter 发送 · Shift+Enter 换行</span>
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          loading={sending}
          disabled={!canSend}
          onClick={() => void handleSend()}
        >
          继续会话
        </Button>
      </div>
    </div>
  );
}
