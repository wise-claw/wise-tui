import { Alert, Drawer, Empty, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeMessage, ToolUsePart } from "../../types";
import { loadClaudeSessionJsonl } from "../../services/claudeDisk";
import { buildTrajectorySequenceModel, type SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import { getToolDisplayInfo } from "./MessageParts";
import { ClaudeSessionSequenceDiagram } from "./ClaudeSessionSequenceDiagram";
import "./ClaudeSessionTrajectoryDrawer.css";

const { Paragraph, Text } = Typography;

const JSONL_TAIL = 8000;

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ClaudeMessage[];
  repositoryPath?: string;
  claudeSessionId?: string | null;
  diskTranscriptPartial?: boolean;
}

export function ClaudeSessionTrajectoryDrawer({
  open,
  onClose,
  messages,
  repositoryPath,
  claudeSessionId,
  diskTranscriptPartial,
}: Props) {
  const [jsonlLines, setJsonlLines] = useState<string[] | null>(null);
  const [jsonlLoading, setJsonlLoading] = useState(false);
  const [jsonlError, setJsonlError] = useState<string | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEndExclusive, setVisibleEndExclusive] = useState(1);
  const [subagentOpen, setSubagentOpen] = useState(false);
  const [subagentPart, setSubagentPart] = useState<ToolUsePart | null>(null);

  const canLoadDisk = Boolean(repositoryPath?.trim() && claudeSessionId?.trim());

  useEffect(() => {
    if (!open) {
      setSubagentOpen(false);
      setSubagentPart(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setJsonlLines(null);
    setJsonlError(null);
    if (!canLoadDisk || !repositoryPath || !claudeSessionId) return;
    let cancelled = false;
    setJsonlLoading(true);
    void loadClaudeSessionJsonl(repositoryPath, claudeSessionId, { tailLines: JSONL_TAIL })
      .then((lines) => {
        if (cancelled) return;
        setJsonlLines(lines);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setJsonlError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setJsonlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canLoadDisk, repositoryPath, claudeSessionId]);

  const events = useMemo(
    () => buildTrajectorySequenceModel(messages, jsonlLines ?? undefined),
    [messages, jsonlLines],
  );

  useEffect(() => {
    const n = events.length;
    const span = Math.min(48, Math.max(8, n));
    if (n === 0) {
      setVisibleStart(0);
      setVisibleEndExclusive(1);
      return;
    }
    // 原先固定对齐「会话尾部」：长会话时首屏是最后 span 条，开头的 user_input 被裁掉，「我」泳道看起来全空。
    const tailStart = Math.max(0, n - span);
    const firstUserIdx = events.findIndex((e) => e.kind === "user_input");
    const start =
      firstUserIdx >= 0 && firstUserIdx < tailStart ? Math.max(0, firstUserIdx) : tailStart;
    setVisibleStart(start);
    setVisibleEndExclusive(Math.min(start + span, n));
  }, [events]);

  const onRangeChange = useCallback((start: number, endExclusive: number) => {
    setVisibleStart(start);
    setVisibleEndExclusive(Math.max(start + 1, endExclusive));
  }, []);

  const onSubagentDrilldown = useCallback((ev: SequenceEvent) => {
    if (!ev.drilldown) return;
    setSubagentPart(ev.drilldown.toolPart);
    setSubagentOpen(true);
  }, []);

  const subagentInfo = subagentPart ? getToolDisplayInfo(subagentPart) : null;
  const subagentInputStr = useMemo(() => {
    if (!subagentPart) return "";
    try {
      return JSON.stringify(subagentPart.input, null, 2);
    } catch {
      return String(subagentPart.input);
    }
  }, [subagentPart]);

  return (
    <>
      <Drawer
        title="工作轨迹 · 序列视图"
        placement="right"
        size={800}
        destroyOnClose
        open={open}
        onClose={onClose}
        styles={{ body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" } }}
      >
        <div className="app-session-trajectory-drawer">
          {diskTranscriptPartial && canLoadDisk ? (
            <Alert
              className="app-session-trajectory-drawer__alert"
              type="info"
              showIcon
              message="当前会话可能为磁盘尾部子集；轨迹中的模型消息与 JSONL 补充均以已加载内容为准，完整历史请先在聊天区加载。"
            />
          ) : null}
          {canLoadDisk ? (
            <div className="app-session-trajectory-drawer__disk">
              {jsonlLoading ? (
                <span className="app-session-trajectory-drawer__disk-loading">
                  <Spin size="small" /> 正在合并磁盘 JSONL（Hooks / init / result 等）…
                </span>
              ) : jsonlError ? (
                <Text type="danger">JSONL 读取失败：{jsonlError}</Text>
              ) : jsonlLines ? (
                <Text type="secondary">
                  已合并最近 {jsonlLines.length} 行 JSONL 补充事件（最多 {JSONL_TAIL} 行）。
                </Text>
              ) : null}
            </div>
          ) : (
            <div className="app-session-trajectory-drawer__disk">
              <Text type="secondary">无仓库路径或未绑定 Claude 会话 ID，仅展示内存消息轨迹（无 Hooks 等磁盘补充）。</Text>
            </div>
          )}

          <div className="app-session-trajectory-drawer__body">
            {events.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无轨迹事件" />
            ) : (
              <ClaudeSessionSequenceDiagram
                events={events}
                visibleStart={visibleStart}
                visibleEndExclusive={visibleEndExclusive}
                onVisibleRangeChange={onRangeChange}
                onSubagentDrilldown={onSubagentDrilldown}
              />
            )}
          </div>
        </div>
      </Drawer>

      <Drawer
        title={subagentInfo ? `子代理 · ${subagentInfo.label}` : "子代理"}
        placement="right"
        size={520}
        open={subagentOpen}
        onClose={() => {
          setSubagentOpen(false);
          setSubagentPart(null);
        }}
        destroyOnClose
      >
        {subagentPart && subagentInfo ? (
          <div className="app-session-trajectory-subagent">
            <Paragraph type="secondary">{subagentInfo.subtitle || "Task 工具调用"}</Paragraph>
            <Text strong>输入（JSON）</Text>
            <pre className="app-session-trajectory-subagent__pre">{subagentInputStr}</pre>
            {subagentPart.output?.trim() ? (
              <>
                <Text strong>输出</Text>
                <pre className="app-session-trajectory-subagent__pre">{subagentPart.output}</pre>
              </>
            ) : null}
            {subagentPart.error?.trim() ? (
              <>
                <Text type="danger">错误</Text>
                <pre className="app-session-trajectory-subagent__pre app-session-trajectory-subagent__pre--err">{subagentPart.error}</pre>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
