import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Collapse, Descriptions, Drawer, Empty, Tag, Typography, message } from "antd";
import {
  DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES,
  DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES,
} from "../../constants/directBatchInvocationLog";
import type { WorkflowInvocationStreamDetail } from "../../constants/workflowUiEvents";
import type { ClaudeMessage, ClaudeSession, MessagePart } from "../../types";
import { readInvocationSnapshotBundle } from "../../services/backgroundInvocationSnapshot";
import { peekDirectBatchInvocationRingSnapshot } from "../../services/claude";
import { extractInitSessionIdFromInvocationStdoutLines } from "../../services/claudeStreamParser";
import {
  assemblePartsFromStdoutLinesForDisplay,
  MAX_STDOUT_LINES_FOR_STREAM_PARTS,
  plainTextFromMessageParts,
} from "../../utils/backgroundInvocationStdoutParts";
import { formatOmcDirectBatchInvocationListTitle } from "../../utils/omcDirectBatchInvocationDisplay";
import { getMessageSenderGroupKey, isToolOnlyUserMessage } from "../../utils/claudeChatMessageDisplay";
import { isWebViewDevToolsLikelyOpen } from "../../utils/adaptivePoll";
import { useClaudeInvocationLiveOutput } from "../../hooks/useClaudeInvocationLiveOutput";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import { ClaudeChatMessageRow } from "../ClaudeSessions/ClaudeChatMessageRow";
import { StreamingReplyHint } from "../ClaudeSessions/Markdown";
import { StreamJsonStdoutHelpButton } from "../StreamJsonStdoutHelpButton";
import "../ClaudeSessions/index.css";
import "./index.css";

const DIRECT_BATCH_STREAM_JSON_HELP_TOOLTIP = `与主会话相同的气泡与解析：stdout 按 Claude Code stream-json 合并为文本 / 思考 / 工具块（最近约 ${DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES} 行参与解析）；Tauri 事件订阅缓冲与落盘对齐，约 ${DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES} 行 stdout、${DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES} 行 stderr。`;

/** 合并 live / 落盘 / 执行中环形缓冲三路 stdout，取行数最多的一侧（晚订阅 Tauri 时环形缓冲仍含已产生行） */
function longestLineArray(...candidates: string[][]): string[] {
  let best: string[] = [];
  for (const c of candidates) {
    if (c.length > best.length) best = c;
  }
  return best;
}

interface Props {
  open: boolean;
  snapshot: WorkflowInvocationStreamDetail | null;
  sessions: ClaudeSession[];
  onClose: () => void;
  /** 跳转仓库主会话并打开「后台执行详情」 */
  onOpenInMainSessionBackground?: (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => void;
}

function resolveAnchorSession(sessions: ClaudeSession[], sessionIdRaw: string): ClaudeSession | undefined {
  const t = sessionIdRaw.trim();
  if (!t) return undefined;
  return sessions.find((s) => s.id === t || s.claudeSessionId?.trim() === t);
}

function resolveAnchorSessionTabLabel(sessions: ClaudeSession[], sessionIdRaw: string): string | null {
  const hit = resolveAnchorSession(sessions, sessionIdRaw);
  const rn = hit?.repositoryName?.trim();
  if (rn && rn.length > 0) return rn;
  const dp = hit?.diskPreview?.trim();
  return dp && dp.length > 0 ? dp : null;
}

function phaseLabelZh(phase: WorkflowInvocationStreamDetail["phase"]): string {
  if (phase === "progress") return "输出中";
  if (phase === "started") return "已启动";
  if (phase === "complete") return "已结束";
  return phase;
}

function phaseTagColor(inv: WorkflowInvocationStreamDetail): string {
  if (inv.phase === "complete") {
    if (inv.success === false) return "error";
    if (inv.success === true) return "success";
    return "default";
  }
  if (inv.phase === "progress") return "processing";
  return "blue";
}

function buildSyntheticInvocationMessages(params: {
  dispatchPrompt: string;
  stdoutParts: MessagePart[];
  stdoutJoin: string;
  stderrLines: string[];
  timeAnchor: number;
}): ClaudeMessage[] {
  const { dispatchPrompt, stdoutParts, stdoutJoin, stderrLines, timeAnchor } = params;
  const stderrText = stderrLines.join("\n");
  const base = timeAnchor;
  const out: ClaudeMessage[] = [];
  let nid = 0;
  const nextId = (): number => {
    nid += 1;
    return -nid;
  };

  const dp = dispatchPrompt.trim();
  if (dp) {
    out.push({
      id: nextId(),
      role: "user",
      content: dp,
      parts: [{ type: "text", text: dp }],
      timestamp: base - 10_000,
    });
  }

  if (stderrText.length > 0) {
    const body = `stderr:\n${stderrText}`;
    out.push({
      id: nextId(),
      role: "system",
      content: body,
      parts: [{ type: "text", text: body }],
      timestamp: base - 5000,
    });
  }

  const assistantParts: MessagePart[] =
    stdoutParts.length > 0
      ? stdoutParts
      : stdoutJoin.length > 0
        ? [{ type: "text", text: stdoutJoin }]
        : [{ type: "text", text: "" }];
  const assistantContent =
    stdoutParts.length > 0 ? plainTextFromMessageParts(stdoutParts) || stdoutJoin : stdoutJoin;

  out.push({
    id: nextId(),
    role: "assistant",
    content: assistantContent,
    parts: assistantParts,
    timestamp: base,
  });

  return out;
}

/** 同一 invocation 每次打开用同一时间锚点，避免 `Date.now()` 抖动导致整段消息列表重挂载与动画重放 */
function syntheticStreamTimeAnchor(input: { invocationKey: string; taskId?: string; attempt?: number }): number {
  const raw = `${input.invocationKey}\t${input.taskId ?? ""}\t${typeof input.attempt === "number" ? input.attempt : ""}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return 1_720_000_000_000 + (u % 2_147_000_000);
}

export function OmcDirectBatchInvocationDetailDrawer({
  open,
  snapshot,
  sessions,
  onClose,
  onOpenInMainSessionBackground: _onOpenInMainSessionBackground,
}: Props) {
  const width = Math.min(560, typeof window !== "undefined" ? window.innerWidth - 40 : 560);
  const inv = open ? snapshot : null;
  const title = inv ? `Claude Code · ${formatOmcDirectBatchInvocationListTitle(inv)}` : "直连批量 OMC";

  const sid = inv?.sessionId?.trim() ?? "";
  const rp = inv?.repositoryPath?.trim() ?? "";
  const ik = inv?.invocationKey?.trim() ?? "";

  const prompt = inv?.dispatchPrompt?.trim() ?? "";
  const parentFinished = inv?.phase === "complete";
  const isDirectBatch = inv?.omcInvocationSource === "direct_batch";

  const streamTimeAnchor = useMemo(
    () =>
      syntheticStreamTimeAnchor({
        invocationKey: ik,
        taskId: inv?.taskId,
        attempt: inv?.attempt,
      }),
    [ik, inv?.taskId, inv?.attempt],
  );

  const { stdoutLines, stderrLines, tauriComplete } = useClaudeInvocationLiveOutput({
    invocationKey: ik,
    enabled: open && Boolean(ik),
    parentInvocationFinished: parentFinished,
  });

  const anchorSession = useMemo(() => resolveAnchorSession(sessions, sid), [sessions, sid]);
  /** 读写 `readInvocationSnapshotBundle` 必须用锚点 Wise 标签 id，与子进程 stream-json 的 `session_id` 无关 */
  const anchorWiseTabIdForBundle = (anchorSession?.id?.trim() || sid).trim();

  /** 锚点会话 bundle 里为该 invocation 持久化的 stdout/stderr（子进程结束后 Tauri 不会重放历史行，必须从磁盘恢复） */
  const [bundlePersistedLines, setBundlePersistedLines] = useState<{ stdout: string[]; stderr: string[] }>({
    stdout: [],
    stderr: [],
  });

  /** 与 `executeClaudeCodeAndWait` 内环形缓冲同步；用 ref 避免每 400ms 复制大数组进 React state */
  const executionRingRef = useRef<{ stdout: string[]; stderr: string[] }>({ stdout: [], stderr: [] });
  const [executionRingTick, setExecutionRingTick] = useState(0);
  useLayoutEffect(() => {
    if (!open || !isDirectBatch || parentFinished || !ik.trim()) {
      executionRingRef.current = { stdout: [], stderr: [] };
      setExecutionRingTick((n) => n + 1);
      return;
    }
    const r = peekDirectBatchInvocationRingSnapshot(ik.trim());
    executionRingRef.current = { stdout: r.stdoutLines, stderr: r.stderrLines };
    setExecutionRingTick((n) => n + 1);
  }, [open, isDirectBatch, parentFinished, ik]);
  useEffect(() => {
    if (!open || !isDirectBatch || parentFinished || !ik.trim()) return;
    const pollMs = isWebViewDevToolsLikelyOpen() ? 4000 : 2000;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const r = peekDirectBatchInvocationRingSnapshot(ik.trim());
      const prev = executionRingRef.current;
      if (
        prev.stdout.length === r.stdoutLines.length &&
        prev.stderr.length === r.stderrLines.length &&
        prev.stdout[prev.stdout.length - 1] === r.stdoutLines[r.stdoutLines.length - 1] &&
        prev.stderr[prev.stderr.length - 1] === r.stderrLines[r.stderrLines.length - 1]
      ) {
        return;
      }
      executionRingRef.current = { stdout: r.stdoutLines, stderr: r.stderrLines };
      setExecutionRingTick((n) => n + 1);
    }, pollMs);
    return () => window.clearInterval(id);
  }, [open, isDirectBatch, parentFinished, ik]);

  /** 实时监听、bundle 落盘、进行中环形缓冲三路合并，取长的一侧以免截断 */
  const effectiveStdoutLines = useMemo(() => {
    return longestLineArray(stdoutLines, bundlePersistedLines.stdout, executionRingRef.current.stdout);
  }, [stdoutLines, bundlePersistedLines.stdout, executionRingTick]);

  const effectiveStderrLines = useMemo(() => {
    return longestLineArray(stderrLines, bundlePersistedLines.stderr, executionRingRef.current.stderr);
  }, [stderrLines, bundlePersistedLines.stderr, executionRingTick]);

  /** 锚点 bundle 仅在子进程完成时写入；侧栏 `phase` 可能仍为 started，据此推断已结束，避免重开时底部「正在思考」假阳性 */
  const hasLoadedPersistedStream =
    bundlePersistedLines.stdout.length > 0 || bundlePersistedLines.stderr.length > 0;

  /** 重新打开已结束记录时不会再次收到 complete 事件：缓冲区空且侧栏已 complete 则视为无需再等 Tauri */
  const assumeTauriDone = useMemo(() => {
    if (tauriComplete) return true;
    if (parentFinished) {
      if (isDirectBatch && hasLoadedPersistedStream) return true;
      return stdoutLines.length === 0 && stderrLines.length === 0;
    }
    if (isDirectBatch && hasLoadedPersistedStream) return true;
    return false;
  }, [
    tauriComplete,
    parentFinished,
    isDirectBatch,
    hasLoadedPersistedStream,
    stdoutLines.length,
    stderrLines.length,
  ]);

  /** 列表 phase 滞后时，标签与描述仍与 bundle 一致显示「已结束」 */
  const displayPhase = useMemo((): WorkflowInvocationStreamDetail["phase"] => {
    if (!inv) return "complete";
    if (inv.phase === "complete") return "complete";
    if (isDirectBatch && hasLoadedPersistedStream) return "complete";
    return inv.phase;
  }, [inv, isDirectBatch, hasLoadedPersistedStream]);

  /** 子进程未完成（或侧栏已结束但仍在等尾部 stdout）时，把尚未写入锚点会话的解析段接在列表末尾 */
  const liveStdoutTailMessages = useMemo(() => {
    if (!anchorSession?.messages.length || assumeTauriDone) return [];
    const hasOut = effectiveStdoutLines.some((line) => line.trim().length > 0);
    const hasErr = effectiveStderrLines.length > 0;
    if (!hasOut && !hasErr) return [];
    const stdoutJoin = effectiveStdoutLines.join("\n");
    const stdoutParts = assemblePartsFromStdoutLinesForDisplay(
      effectiveStdoutLines.slice(-MAX_STDOUT_LINES_FOR_STREAM_PARTS),
    );
    return buildSyntheticInvocationMessages({
      dispatchPrompt: "",
      stdoutParts,
      stdoutJoin,
      stderrLines: effectiveStderrLines,
      timeAnchor: streamTimeAnchor,
    });
  }, [anchorSession, assumeTauriDone, effectiveStdoutLines, effectiveStderrLines, streamTimeAnchor]);

  const streamMessages = useMemo(() => {
    const stdoutParseCap = isDirectBatch
      ? DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES
      : MAX_STDOUT_LINES_FOR_STREAM_PARTS;
    const sliceStart = Math.max(0, effectiveStdoutLines.length - stdoutParseCap);
    const linesForParts = effectiveStdoutLines.slice(sliceStart);
    const stdoutJoin = effectiveStdoutLines.join("\n");
    const stdoutParts = assemblePartsFromStdoutLinesForDisplay(linesForParts);
    return buildSyntheticInvocationMessages({
      dispatchPrompt: prompt,
      stdoutParts,
      stdoutJoin,
      stderrLines: effectiveStderrLines,
      timeAnchor: streamTimeAnchor,
    });
  }, [isDirectBatch, prompt, effectiveStdoutLines, effectiveStderrLines, streamTimeAnchor]);

  /**
   * 直连批量子进程 stdout 不落主会话 `messages`，仅用 `streamMessages`（bundle + 实时 effectiveStdout）才能看到完整输出。
   * 若走 `drawerPeekSession`，结束后 `liveStdoutTailMessages` 为空，会只剩主会话气泡、历史子进程正文「丢失」。
   */
  const drawerPeekSession = useMemo((): ClaudeSession | null => {
    if (isDirectBatch) return null;
    if (!anchorSession?.messages.length) return null;
    const merged = [...anchorSession.messages, ...liveStdoutTailMessages];
    const effectiveStatus: ClaudeSession["status"] = !assumeTauriDone ? "running" : anchorSession.status;
    return { ...anchorSession, messages: merged, status: effectiveStatus };
  }, [isDirectBatch, anchorSession, liveStdoutTailMessages, assumeTauriDone]);

  /** 子进程 stream-json init 的 `session_id`（优先锚点 bundle 内持久化 stdout，运行中辅以 `effectiveStdoutLines` 实时解析）。 */
  const [stdoutInitSessionId, setStdoutInitSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !inv) {
      setStdoutInitSessionId(null);
      setBundlePersistedLines({ stdout: [], stderr: [] });
      return;
    }
    const tabId = anchorWiseTabIdForBundle;
    const repo = rp.trim();
    const invocationKey = ik.trim();
    if (!tabId || !repo || !invocationKey) {
      setStdoutInitSessionId(null);
      setBundlePersistedLines({ stdout: [], stderr: [] });
      return;
    }
    setStdoutInitSessionId(null);
    setBundlePersistedLines({ stdout: [], stderr: [] });
    let cancelled = false;
    void readInvocationSnapshotBundle(tabId, repo).then((bundle) => {
      if (cancelled) return;
      const snap = bundle.items[invocationKey];
      setBundlePersistedLines({
        stdout: snap?.stdoutLines?.length
          ? snap.stdoutLines.slice(-DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES)
          : [],
        stderr: snap?.stderrLines?.length
          ? snap.stderrLines.slice(-DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES)
          : [],
      });
      const extracted =
        snap?.stdoutLines && snap.stdoutLines.length > 0
          ? extractInitSessionIdFromInvocationStdoutLines(snap.stdoutLines)
          : null;
      setStdoutInitSessionId(extracted);
    });
    return () => {
      cancelled = true;
    };
  }, [open, inv, anchorWiseTabIdForBundle, rp, ik]);

  /** 子进程内 Claude Code `session_id`：侧栏派发优先，其次 bundle/stdout 解析（抽屉晚订阅时仍可有 id） */
  const resolvedSubprocessInitSessionId = useMemo(() => {
    const fromUi = inv?.subprocessSessionId?.trim() || "";
    if (fromUi) return fromUi;
    const fromLive = extractInitSessionIdFromInvocationStdoutLines(effectiveStdoutLines);
    return (stdoutInitSessionId?.trim() || fromLive?.trim() || "").trim();
  }, [inv?.subprocessSessionId, stdoutInitSessionId, effectiveStdoutLines]);

  /** 会话消息第一行：始终为 Wise 锚点标签 id（与子进程 Claude 会话 id 区分） */
  const appSessionIdForDisplay = anchorWiseTabIdForBundle;

  /** 直连批量勿回退到锚点主会话 `claudeSessionId`，否则每批详情里会一直显示同一条主会话 id */
  const claudeCodeSessionIdForDisplay = (
    isDirectBatch
      ? resolvedSubprocessInitSessionId
      : stdoutInitSessionId?.trim() || anchorSession?.claudeSessionId?.trim() || ""
  ).trim();

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    open,
    anchorSession?.messages.length,
    effectiveStdoutLines.length,
    effectiveStderrLines.length,
    streamMessages.length,
    drawerPeekSession?.messages.length,
    streamTimeAnchor,
  ]);

  const lastIdx = streamMessages.length - 1;
  const lastMsg = lastIdx >= 0 ? streamMessages[lastIdx]! : null;
  const showListEndThinkingHint =
    !assumeTauriDone && lastMsg !== null && (lastMsg.role === "user" || lastMsg.role === "assistant");

  const handleCopyDispatch = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      void message.error("复制失败，请检查剪贴板权限");
    }
  }, [prompt]);

  const showLiveHintRow = Boolean(ik && !assumeTauriDone);

  return (
    <Drawer
      title={<span className="app-omc-direct-batch-inv-detail__drawer-title-text">{title}</span>}
      placement="right"
      size={width}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{
        header: "app-omc-direct-batch-inv-detail-drawer-header",
        body: "app-omc-direct-batch-inv-detail-drawer-body",
      }}
    >
      {!inv ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />
      ) : (
        <div className="app-omc-direct-batch-inv-detail">
          <Collapse
            bordered={false}
            size="small"
            ghost
            className="app-omc-direct-batch-inv-detail__context-collapse"
            defaultActiveKey={[]}
            expandIconPosition="end"
            items={[
              {
                key: "ctx",
                label: "会话与执行上下文",
                children: (
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="阶段">{phaseLabelZh(displayPhase)}</Descriptions.Item>
                    <Descriptions.Item label="子进程 invocationKey">
                      <Typography.Text code copyable>
                        {inv.invocationKey}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="锚点会话 tab id">
                      <Typography.Text code copyable>
                        {sid || "—"}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="锚点标签展示名">{resolveAnchorSessionTabLabel(sessions, sid) ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="仓库路径">
                      <Typography.Text code copyable>
                        {rp || "—"}
                      </Typography.Text>
                    </Descriptions.Item>
                    {inv.taskTitle?.trim() ? (
                      <Descriptions.Item label="任务标题">{inv.taskTitle.trim()}</Descriptions.Item>
                    ) : null}
                    {inv.taskId?.trim() ? (
                      <Descriptions.Item label="任务 id">
                        <Typography.Text code>{inv.taskId.trim()}</Typography.Text>
                      </Descriptions.Item>
                    ) : null}
                    {inv.templateId?.trim() ? (
                      <Descriptions.Item label="OMC 模板">{inv.templateId.trim()}</Descriptions.Item>
                    ) : null}
                    {typeof inv.attempt === "number" ? <Descriptions.Item label="attempt">{inv.attempt}</Descriptions.Item> : null}
                    <Descriptions.Item label="stdout 行数（侧栏心跳）">{inv.lineCount ?? 0}</Descriptions.Item>
                    <Descriptions.Item label="stderr 行数（侧栏心跳）">{inv.errCount ?? 0}</Descriptions.Item>
                    {displayPhase === "complete" ? (
                      <Descriptions.Item label="子进程退出">
                        {inv.success === true ? "成功" : inv.success === false ? "失败" : "—"}
                      </Descriptions.Item>
                    ) : null}
                  </Descriptions>
                ),
              },
            ]}
          />

          <div className="app-omc-direct-batch-inv-detail__messages-title-row">
            <div className="app-omc-direct-batch-inv-detail__messages-title-start">
              <span className="app-omc-direct-batch-inv-detail__messages-title-label">会话消息</span>
              <div className="app-omc-direct-batch-inv-detail__messages-title-ids">
                <div className="app-omc-direct-batch-inv-detail__messages-title-id-row">
                  <span className="app-omc-direct-batch-inv-detail__messages-title-id-label">
                    {isDirectBatch ? "应用（锚点）" : "应用"}
                  </span>
                  <Typography.Text
                    type="secondary"
                    className="app-omc-direct-batch-inv-detail__messages-title-session-id"
                    code
                    copyable={
                      appSessionIdForDisplay.length > 0
                        ? {
                            text: appSessionIdForDisplay,
                            tooltips: [
                              isDirectBatch ? "复制 Wise 锚点标签 id" : "复制应用会话 id",
                              "已复制",
                            ],
                          }
                        : false
                    }
                  >
                    {appSessionIdForDisplay.length > 0 ? appSessionIdForDisplay : "—"}
                  </Typography.Text>
                </div>
                <div className="app-omc-direct-batch-inv-detail__messages-title-id-row">
                  <span className="app-omc-direct-batch-inv-detail__messages-title-id-label">
                    {isDirectBatch ? "Claude Code（子进程）" : "Claude Code"}
                  </span>
                  <Typography.Text
                    type="secondary"
                    className="app-omc-direct-batch-inv-detail__messages-title-session-id"
                    code
                    copyable={
                      claudeCodeSessionIdForDisplay.length > 0
                        ? {
                            text: claudeCodeSessionIdForDisplay,
                            tooltips: [
                              isDirectBatch ? "复制子进程 Claude Code 会话 id" : "复制 Claude Code 会话 id",
                              "已复制",
                            ],
                          }
                        : false
                    }
                  >
                    {claudeCodeSessionIdForDisplay.length > 0 ? claudeCodeSessionIdForDisplay : "—"}
                  </Typography.Text>
                </div>
              </div>
              <Tag
                className="app-omc-direct-batch-inv-detail__messages-title-phase-tag"
                color={phaseTagColor({ ...inv, phase: displayPhase })}
              >
                {phaseLabelZh(displayPhase)}
              </Tag>
            </div>
          </div>

          {showLiveHintRow ? (
            <div className="app-omc-direct-batch-inv-detail__live-hint-row">
              <Typography.Text type="secondary" className="app-omc-direct-batch-inv-detail__live-hint-text">
                子进程 stream-json 会实时解析并接在下方末尾（最近约{" "}
                {isDirectBatch
                  ? DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES
                  : MAX_STDOUT_LINES_FOR_STREAM_PARTS}{" "}
                行参与解析）。
              </Typography.Text>
              <StreamJsonStdoutHelpButton ariaLabel="实时输出说明" tooltipTitle={DIRECT_BATCH_STREAM_JSON_HELP_TOOLTIP} />
            </div>
          ) : null}

          <div className="app-omc-direct-batch-inv-detail__messages-root">
            <div className="app-claude-chat app-omc-direct-batch-inv-detail__messages-chat">
              {drawerPeekSession ? (
                <ClaudeSessionMessagesColumn
                  session={drawerPeekSession}
                  showAllMessages
                  scrollContainerRef={messagesScrollRef}
                />
              ) : (
                <div ref={messagesScrollRef} className="app-claude-messages">
                  {streamMessages.map((msg, index) => {
                    const streamingThisBubble =
                      !assumeTauriDone && msg.role === "assistant" && index === lastIdx;
                    const toolUser = isToolOnlyUserMessage(msg);
                    const prevInSession = index > 0 ? streamMessages[index - 1] : undefined;
                    const mergedWithPrevious =
                      prevInSession !== undefined &&
                      getMessageSenderGroupKey(prevInSession) === getMessageSenderGroupKey(msg);
                    return (
                      <ClaudeChatMessageRow
                        key={msg.id}
                        msg={msg}
                        streamingThisBubble={streamingThisBubble}
                        mergedWithPrevious={mergedWithPrevious}
                        toolUser={toolUser}
                      />
                    );
                  })}
                  {showListEndThinkingHint ? (
                    <div className="app-claude-messages-end-thinking">
                      <StreamingReplyHint />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="app-omc-direct-batch-inv-detail__dispatch">
            <div className="app-omc-direct-batch-inv-detail__dispatch-head">
              <div className="app-omc-direct-batch-inv-detail__dispatch-head-text">
                <Typography.Text strong className="app-omc-direct-batch-inv-detail__dispatch-title">
                  派发全文
                </Typography.Text>
                <Typography.Text type="secondary" className="app-omc-direct-batch-inv-detail__dispatch-hint">
                  与首条「我」及 <Typography.Text code>execute_claude_code</Typography.Text> 一致
                </Typography.Text>
              </div>
              <Button size="small" type="primary" ghost disabled={!prompt} onClick={() => void handleCopyDispatch()}>
                复制
              </Button>
            </div>
            {prompt.length > 0 ? (
              <pre className="app-omc-direct-batch-inv-detail__pre app-omc-direct-batch-inv-detail__pre--compact">{prompt}</pre>
            ) : (
              <Empty
                className="app-omc-direct-batch-inv-detail__dispatch-empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="未附带派发正文"
              />
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
