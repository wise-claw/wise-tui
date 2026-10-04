import { useMemo, useState } from "react";
import { Alert, Button, Drawer, Select, Space, Spin, Tag, Typography } from "antd";
import type { ClaudeMessage, ClaudeSession, ToolUsePart } from "../../types";
import { buildSubagentCardModel, subagentTranscriptIds } from "../../utils/subagentToolDisplay";
import { useSessionSubagentMessages } from "../../hooks/useSessionSubagentMessages";
import { ClaudeSessionMessagesColumn } from "./ClaudeSessionMessagesColumn";

export default function SubagentMessagesDrawer({ parentSession, part, onClose }: {
  parentSession: ClaudeSession;
  part: ToolUsePart;
  onClose: () => void;
}) {
  const model = buildSubagentCardModel(part);
  const ids = subagentTranscriptIds(part);
  const [selectedId, setSelectedId] = useState("");
  const agentId = ids.includes(selectedId) ? selectedId : ids[0] ?? "";
  const [revision, setRevision] = useState(0);
  const [fullHistory, setFullHistory] = useState(false);
  const codex = part.name.toLowerCase().startsWith("collab_") || parentSession.executionEngine === "codex-rpc";
  const running = model.waiting || parentSession.status === "running" || parentSession.status === "connecting"
    || part.input.run_in_background === true;
  const transcript = useSessionSubagentMessages({
    repositoryPath: parentSession.repositoryPath,
    parentSessionId: parentSession.claudeSessionId ?? "",
    toolUseId: part.id,
    agentId,
    codex,
    running,
    fullHistory,
    revision,
  });
  const fallbackMessages = useMemo(() => {
    const messages: ClaudeMessage[] = [];
    const prompt = part.input.prompt ?? part.input.instructions;
    if (typeof prompt === "string" && prompt.trim()) {
      messages.push({ id: 1, role: "user", content: prompt, parts: [], timestamp: 0 });
    }
    const states = part.input.agentsStates ?? part.input.agents_states;
    const agentState = states && typeof states === "object" ? (states as Record<string, unknown>)[agentId] : null;
    const stateMessage = agentState && typeof agentState === "object" ? (agentState as Record<string, unknown>).message : null;
    const result = part.error || part.output || (typeof stateMessage === "string" ? stateMessage : "");
    if (result.trim()) {
      messages.push({ id: 2, role: "assistant", content: result, parts: [], timestamp: 0 });
    }
    return messages;
  }, [part, agentId]);
  const session: ClaudeSession = {
    ...parentSession,
    id: `subagent-${part.id}-${agentId}`,
    claudeSessionId: codex ? null : parentSession.claudeSessionId,
    messages: transcript.messages.length > 0 ? transcript.messages : fallbackMessages,
    status: model.waiting ? "running" : part.status === "error" ? "error" : "completed",
    diskTranscriptPartial: transcript.partial,
    transcriptMemoryUnlimited: fullHistory,
    pendingPrompt: "",
  };

  return (
    <Drawer
      title={`子代理 · ${model.title}`}
      open
      onClose={onClose}
      size={Math.min(800, typeof window === "undefined" ? 800 : window.innerWidth - 32)}
      destroyOnHidden
      classNames={{ body: "app-subagent-messages-drawer__body" }}
      extra={<Tag color={model.waiting ? "processing" : part.status === "error" ? "error" : "success"}>
        {model.waiting ? "运行中" : part.status === "error" ? "失败" : "已返回"}
      </Tag>}
    >
      <Space wrap className="app-subagent-messages-drawer__toolbar">
        {agentId ? <Typography.Text copyable>{agentId}</Typography.Text> : null}
        {ids.length > 1 ? <Select aria-label="选择子代理" value={agentId} onChange={(value) => {
          setSelectedId(value); setFullHistory(false);
        }} options={ids.map((id) => ({ label: id, value: id }))} /> : null}
        <Button size="small" loading={transcript.loading} onClick={() => setRevision((value) => value + 1)}>刷新消息</Button>
        {transcript.partial ? <Button size="small" onClick={() => setFullHistory(true)}>加载完整历史</Button> : null}
      </Space>
      {transcript.error ? <Alert type="warning" showIcon title="暂时无法读取子代理消息" description={transcript.error} /> : null}
      {!transcript.loading && transcript.messages.length === 0 ? (
        <Alert type="info" showIcon title={running ? "等待子代理消息，当前显示任务和已返回的结果" : "暂无独立消息记录，当前显示任务和已返回的结果"} />
      ) : null}
      {transcript.loading && session.messages.length === 0 ? <Spin /> : null}
      <ClaudeSessionMessagesColumn session={session} listVariant="chat" pinUserMessages={false} />
    </Drawer>
  );
}
