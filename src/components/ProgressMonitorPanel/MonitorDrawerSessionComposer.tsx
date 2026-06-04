import { SendOutlined } from "@ant-design/icons";
import { Button, Input, message } from "antd";
import { useCallback, useState } from "react";
import type { ClaudeSession } from "../../types";

export type MonitorDrawerResumeSessionFn = (
  sessionId: string,
  prompt: string,
) => boolean | void;

export function MonitorDrawerSessionComposer({
  session,
  onResumeSession,
  disabledReason,
}: {
  session: ClaudeSession | null | undefined;
  onResumeSession?: MonitorDrawerResumeSessionFn;
  disabledReason?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const sessionId = session?.id?.trim() ?? "";
  const blocked = Boolean(disabledReason?.trim());
  const canSend = Boolean(onResumeSession && sessionId && draft.trim() && !blocked);

  const handleSend = useCallback(() => {
    const prompt = draft.trim();
    if (!prompt || !sessionId || !onResumeSession || blocked) return;
    setSending(true);
    try {
      const ok = onResumeSession(sessionId, prompt);
      if (ok === false) {
        message.warning("未能发送，请确认会话仍可用或稍后再试");
        return;
      }
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [blocked, draft, onResumeSession, sessionId]);

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
          if (canSend) handleSend();
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
          onClick={handleSend}
        >
          继续会话
        </Button>
      </div>
    </div>
  );
}
