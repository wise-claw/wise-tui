import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  WorkflowGraph,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../../types";
import { Button, Empty, Input, message, Popover, Spin, Switch, Tooltip } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useDockSlice } from "../../hooks/useDockSlice";
import { ClaudeChat } from "./ClaudeChat";
import { OpenAppMenu } from "../OpenAppMenu";
import {
  DEFAULT_OPEN_APP_ID,
} from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";
import { openTerminalSession, writeTerminalSession } from "../../services/terminal";
import { subscribeTerminalExit, subscribeTerminalOutput } from "../../services/events";
import { openExternalUrl } from "../../services/openExternal";
import { filterSessionsForWorkspace } from "../../utils/projectSessionPanelFilter";
import { resolveRepositoryForSession } from "../../utils/repositoryMainSessionBinding";
import type { WorkspaceMode } from "../../utils/workspaceMode";
import "./index.css";

const TerminalPanelLazy = lazy(() =>
  import("../TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);

const RUN_ERROR_MONITOR_DEDUP_WINDOW_MS = 60_000;
const runErrorMonitorSentAtByKey = new Map<string, number>();

function buildRunErrorMonitorDedupKey(runCwd: string, command: string, tailText: string): string {
  const normalizedTail = tailText
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(-800);
  return `${runCwd.trim().toLowerCase()}|${command.trim().toLowerCase()}|${normalizedTail}`;
}

function shouldSkipRunErrorMonitorSend(dedupKey: string, now: number): boolean {
  const lastAt = runErrorMonitorSentAtByKey.get(dedupKey);
  if (lastAt && now - lastAt < RUN_ERROR_MONITOR_DEDUP_WINDOW_MS) {
    return true;
  }
  runErrorMonitorSentAtByKey.set(dedupKey, now);
  if (runErrorMonitorSentAtByKey.size > 200) {
    const expireBefore = now - RUN_ERROR_MONITOR_DEDUP_WINDOW_MS;
    for (const [key, sentAt] of runErrorMonitorSentAtByKey.entries()) {
      if (sentAt < expireBefore) {
        runErrorMonitorSentAtByKey.delete(key);
      }
    }
  }
  return false;
}

interface SessionEmptyStateProps {
  title: string;
  hint: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

function SessionEmptyState({
  title,
  hint,
  primaryAction,
  secondaryAction,
}: SessionEmptyStateProps) {
  return (
    <div className="app-claude-session-empty">
      <Empty
        className="app-claude-session-empty__content"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span className="app-claude-session-empty__copy">
            <span className="app-claude-session-empty__title">{title}</span>
            <span className="app-claude-session-empty__hint">{hint}</span>
          </span>
        }
      >
        {primaryAction || secondaryAction ? (
          <div className="app-claude-session-empty__actions">
            {primaryAction ? (
              <Button type="primary" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Empty>
    </div>
  );
}

/** 仅从终端输出识别本机 dev 地址：localhost / 127.0.0.1 / 0.0.0.0 / IPv4 / 方括号 IPv6，不匹配任意域名。 */
const RUN_LOG_URL_REGEX =
  /(https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?|\[[0-9a-fA-F:]+\](?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?)(?:\/[^\s]*)?)/i;
const RUN_LOG_HOST_PORT_REGEX =
  /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|(?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})(\/[^\s]*)?\b/i;
const RUN_LOG_IPV6_BRACKET_PORT_REGEX = /\[([0-9a-fA-F:]+)\]:(\d{2,5})(\/[^\s]*)?\b/i;

function detectRunUrlFromLogText(text: string): string | null {
  const plain = text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const direct = plain.match(RUN_LOG_URL_REGEX)?.[1];
  if (direct) {
    return direct
      .replace("0.0.0.0", "localhost")
      .replace("127.0.0.1", "localhost");
  }
  const hostPort = plain.match(RUN_LOG_HOST_PORT_REGEX);
  if (hostPort?.[1] && hostPort?.[2]) {
    const host = hostPort[1]
      .replace("0.0.0.0", "localhost")
      .replace("127.0.0.1", "localhost");
    const suffix = hostPort[3] ?? "";
    return `http://${host}:${hostPort[2]}${suffix}`;
  }
  const v6 = plain.match(RUN_LOG_IPV6_BRACKET_PORT_REGEX);
  if (v6?.[1] && v6?.[2]) {
    const suffix = v6[3] ?? "";
    return `http://[${v6[1]}]:${v6[2]}${suffix}`;
  }
  return null;
}

// ── SVG Icons ──

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5.5 3.75v8.5l6.75-4.25L5.5 3.75Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 6L7 8.5L4.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="9" y1="11" x2="11.5" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconDualPane() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2.5" width="5.5" height="11" rx="1" />
      <rect x="9" y="2.5" width="5.5" height="11" rx="1" />
    </svg>
  );
}

function IconCollapseSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      {collapsed ? (
        <path d="M14 9l3 3-3 3" />
      ) : (
        <path d="M16 15l-3-3 3-3" />
      )}
    </svg>
  );
}

function IconRightPanel({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      {collapsed ? (
        <path d="M10 15l-3-3 3-3" />
      ) : (
        <path d="M8 9l3 3-3 3" />
      )}
    </svg>
  );
}

type ClaudeSessionChatWithDockProps = Omit<
  ComponentProps<typeof ClaudeChat>,
  | "todos"
  | "questionRequest"
  | "questionRequestQueueLength"
  | "questionRequestStatus"
  | "questionRequestError"
  | "permissionRequest"
  | "permissionRequestStatus"
  | "permissionRequestError"
  | "followupItems"
  | "revertItems"
>;

/** 在子树内 `useDockSlice`，避免双栏时一侧通知桶更新导致另一侧整棵 `ClaudeChat` 跟着 reconcile。 */
function ClaudeSessionChatWithDock(props: ClaudeSessionChatWithDockProps) {
  const dock = useDockSlice(props.session.id);
  return (
    <ClaudeChat
      {...props}
      todos={dock.todos}
      questionRequest={dock.questionRequest}
      questionRequestQueueLength={dock.questionRequestQueue.length}
      questionRequestStatus={dock.questionRequestStatus}
      questionRequestError={dock.questionRequestError}
      permissionRequest={dock.permissionRequest}
      permissionRequestStatus={dock.permissionRequestStatus}
      permissionRequestError={dock.permissionRequestError}
      followupItems={dock.followupItems}
      revertItems={dock.revertItems}
    />
  );
}

// ── Topbar Button ──

interface TopbarBtnProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}

function TopbarBtn({ icon, label, onClick, active }: TopbarBtnProps) {
  return (
    <Tooltip title={label} mouseEnterDelay={0.3}>
      <button
        className={`app-topbar-btn ${active ? "active" : ""}`}
        onClick={onClick}
        type="button"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// ── Topbar ──

interface TopbarProps {
  activeRepository?: Repository;
  activeSessionRepositoryPath?: string;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
  onToggleTerminal?: () => void;
  onSearch?: () => void;
  collapsed?: boolean;
  rightCollapsed?: boolean;
  terminalCollapsed?: boolean;
  onAutoFixRunError?: (prompt: string) => void | Promise<void>;
  /** 双窗格模式开关 */
  dualPaneEnabled?: boolean;
  onToggleDualPane?: () => void;
}

function Topbar({
  activeRepository,
  activeSessionRepositoryPath,
  onToggleSidebar,
  onToggleRightPanel,
  onToggleTerminal,
  onSearch,
  collapsed,
  rightCollapsed,
  terminalCollapsed,
  onAutoFixRunError,
  dualPaneEnabled,
  onToggleDualPane,
}: TopbarProps) {
  const [selectedOpenAppId, setSelectedOpenAppId] = useState<string>(() => {
    return getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  });
  const [runPopoverOpen, setRunPopoverOpen] = useState(false);
  const [runCommand, setRunCommand] = useState("");
  const [runPreferredUrl, setRunPreferredUrl] = useState("");
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "stopping">("idle");
  const [runStatusHint, setRunStatusHint] = useState("未运行");
  const [runOutputPreview, setRunOutputPreview] = useState<Array<{ text: string; isError: boolean }>>([]);
  const [runDetectedUrl, setRunDetectedUrl] = useState<string | null>(null);
  const [runErrorMonitorEnabled, setRunErrorMonitorEnabled] = useState(true);
  const runLogTailRef = useRef("");
  const runChunkBufferRef = useRef("");
  const idleTimerRef = useRef<number | null>(null);
  const autoOpenFallbackTimerRef = useRef<number | null>(null);
  const autoOpenedRunUrlRef = useRef(false);
  const errorDetectedRef = useRef(false);
  const autoFixSentRef = useRef(false);

  const RUNNER_TERMINAL_ID = "topbar-runner";
  const runCwd = activeSessionRepositoryPath?.trim() || "";
  const runKey = runCwd ? `wise.topbar.run-command:${runCwd}` : null;
  const runUrlKey = runCwd ? `wise.topbar.run-open-url:${runCwd}` : null;
  const RUN_ERROR_REGEX = /(error|failed|exception|traceback|npm err|build failed|编译失败|报错|panic)/i;

  const normalizeOpenUrl = useCallback((raw: string): string | null => {
    const input = raw.trim();
    if (!input) return null;
    // 本地路径不是访问地址（例如 /Users/...）
    if (
      input.startsWith("/") ||
      input.startsWith("./") ||
      input.startsWith("../") ||
      input.startsWith("~")
    ) {
      return null;
    }
    const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const host = url.hostname
        .replace("0.0.0.0", "localhost")
        .replace("127.0.0.1", "localhost");
      const pathname = url.pathname === "/" ? "" : url.pathname;
      return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}${pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearAutoOpenFallbackTimer = useCallback(() => {
    if (autoOpenFallbackTimerRef.current != null) {
      window.clearTimeout(autoOpenFallbackTimerRef.current);
      autoOpenFallbackTimerRef.current = null;
    }
  }, []);

  const appendRunOutputPreview = useCallback((chunk: string) => {
    // Remove ANSI escape sequences and normalize CR/LF.
    const plain = chunk
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const mixed = `${runChunkBufferRef.current}${plain}`;
    const parts = mixed.split("\n");
    runChunkBufferRef.current = parts.pop() ?? "";
    const nextLines = parts
      .map((line) => line.trim())
      .filter(Boolean);
    if (nextLines.length === 0) return;
    const mapped = nextLines.map((line) => ({ text: line, isError: RUN_ERROR_REGEX.test(line) }));
    setRunOutputPreview((prev) => [...prev, ...mapped].slice(-8));
  }, []);

  useEffect(() => {
    void (async () => {
      await hydrateOpenAppPreference();
      setSelectedOpenAppId(getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID);
    })();
  }, []);

  useEffect(() => {
    if (!runKey) {
      setRunCommand("");
      return;
    }
    setRunCommand(window.localStorage.getItem(runKey) ?? "");
  }, [runKey]);

  useEffect(() => {
    if (!runUrlKey) {
      setRunPreferredUrl("");
      return;
    }
    setRunPreferredUrl(window.localStorage.getItem(runUrlKey) ?? "");
  }, [runUrlKey]);

  const saveRunCommand = useCallback(() => {
    if (!runKey) return;
    const next = runCommand.trim();
    if (!next) {
      message.warning("请输入运行指令");
      return;
    }
    window.localStorage.setItem(runKey, next);
    setRunCommand(next);
    setRunStatusHint("指令已保存");
    message.success("运行指令已保存");
  }, [runCommand, runKey]);

  const saveRunOpenUrl = useCallback(() => {
    if (!runUrlKey) return;
    const next = runPreferredUrl.trim();
    if (!next) {
      window.localStorage.removeItem(runUrlKey);
      setRunPreferredUrl("");
      setRunStatusHint("已清空指定地址，将自动使用检测/默认地址");
      message.success("已清空指定打开地址");
      return;
    }
    const normalized = normalizeOpenUrl(next);
    if (!normalized) {
      message.warning("请输入有效的访问地址（http/https），不能是仓库本地路径。");
      return;
    }
    window.localStorage.setItem(runUrlKey, normalized);
    setRunPreferredUrl(normalized);
    setRunStatusHint("指定地址已保存");
    message.success("指定打开地址已保存");
  }, [normalizeOpenUrl, runPreferredUrl, runUrlKey]);

  const inferDefaultRunUrl = useCallback((): string => {
    const cmd = runCommand.trim();
    const portByFlag = cmd.match(/(?:--port|-p)\s*(\d{2,5})/i)?.[1];
    const portByEnv = cmd.match(/PORT=(\d{2,5})/i)?.[1];
    const port = portByFlag || portByEnv || "16088";
    return `http://localhost:${port}`;
  }, [runCommand]);

  const resolveOpenUrl = useCallback((): string => {
    const preferred = normalizeOpenUrl(runPreferredUrl);
    if (preferred) return preferred;
    if (runDetectedUrl) return runDetectedUrl;
    return inferDefaultRunUrl();
  }, [inferDefaultRunUrl, normalizeOpenUrl, runDetectedUrl, runPreferredUrl]);

  const startRun = useCallback(async () => {
    if (!activeRepository || !runCwd) return;
    const cmd = runCommand.trim();
    if (!cmd) {
      setRunPopoverOpen(true);
      return;
    }
    try {
      await openTerminalSession(
        String(activeRepository.id),
        RUNNER_TERMINAL_ID,
        120,
        36,
        runCwd,
      ).catch(() => {
        // ignore "already opened" and continue
      });
      errorDetectedRef.current = false;
      autoFixSentRef.current = false;
      autoOpenedRunUrlRef.current = false;
      runLogTailRef.current = "";
      runChunkBufferRef.current = "";
      setRunOutputPreview([]);
      setRunDetectedUrl(null);
      setRunStatusHint("启动中...");
      clearIdleTimer();
      clearAutoOpenFallbackTimer();
      await writeTerminalSession(String(activeRepository.id), RUNNER_TERMINAL_ID, `${cmd}\n`);
      setRunStatus("running");
      setRunStatusHint("运行中");
      setRunPopoverOpen(false);
      // 若日志迟迟未打印 URL，则兜底自动打开默认地址（或指定地址）。
      autoOpenFallbackTimerRef.current = window.setTimeout(() => {
        if (autoOpenedRunUrlRef.current) return;
        const fallbackUrl = resolveOpenUrl();
        autoOpenedRunUrlRef.current = true;
        void openExternalUrl(fallbackUrl);
        setRunStatusHint(`已自动打开地址：${fallbackUrl}`);
      }, 4500);
    } catch (error) {
      const msgText = error instanceof Error ? error.message : String(error);
      message.error(`运行失败: ${msgText}`);
      setRunStatus("idle");
      setRunStatusHint("启动失败");
    }
  }, [activeRepository, clearAutoOpenFallbackTimer, clearIdleTimer, resolveOpenUrl, runCommand, runCwd]);

  const stopRun = useCallback(async () => {
    if (!activeRepository) return;
    setRunStatus("stopping");
    setRunStatusHint("停止中...");
    try {
      await writeTerminalSession(String(activeRepository.id), RUNNER_TERMINAL_ID, "\u0003");
      setRunStatus("idle");
      setRunStatusHint("已停止");
      clearIdleTimer();
      clearAutoOpenFallbackTimer();
    } catch (error) {
      const msgText = error instanceof Error ? error.message : String(error);
      message.error(`停止失败: ${msgText}`);
      setRunStatus("idle");
      setRunStatusHint("停止失败");
    }
  }, [activeRepository, clearAutoOpenFallbackTimer, clearIdleTimer]);

  const handleRunButtonClick = useCallback(() => {
    if (!runCwd) {
      message.warning("当前会话未绑定仓库路径，无法运行。请先切换到具体仓库会话。");
      return;
    }
    const cmd = runCommand.trim();
    if (!cmd) {
      setRunPopoverOpen(true);
      return;
    }
    if (runStatus === "running" || runStatus === "stopping") {
      void stopRun();
      return;
    }
    void startRun();
  }, [runCwd, runCommand, runStatus, startRun, stopRun]);

  useEffect(() => {
    const unlistenOutput = subscribeTerminalOutput((payload) => {
      if (!activeRepository) return;
      if (payload.workspaceId !== String(activeRepository.id) || payload.terminalId !== RUNNER_TERMINAL_ID) return;
      const nextTail = `${runLogTailRef.current}${payload.data}`.slice(-10_000);
      runLogTailRef.current = nextTail;
      appendRunOutputPreview(payload.data);
      const detected = detectRunUrlFromLogText(payload.data) ?? detectRunUrlFromLogText(nextTail);
      if (detected) {
        setRunDetectedUrl(detected);
        if (!autoOpenedRunUrlRef.current) {
          autoOpenedRunUrlRef.current = true;
          clearAutoOpenFallbackTimer();
          const preferred = normalizeOpenUrl(runPreferredUrl);
          const urlToOpen = preferred ?? detected;
          void openExternalUrl(urlToOpen);
          setRunStatusHint(`已自动打开地址：${urlToOpen}`);
        }
      }
      if (RUN_ERROR_REGEX.test(payload.data) && runErrorMonitorEnabled) {
        errorDetectedRef.current = true;
        setRunPopoverOpen(true);
        setRunStatusHint("检测到报错，等待自动处理...");
      }
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        if (!errorDetectedRef.current || autoFixSentRef.current) return;
        autoFixSentRef.current = true;
        if (!onAutoFixRunError) return;
        const command = runCommand.trim();
        const dedupKey = buildRunErrorMonitorDedupKey(runCwd, command, nextTail);
        if (shouldSkipRunErrorMonitorSend(dedupKey, Date.now())) {
          setRunStatusHint("检测到重复报错，已跳过重复发送");
          return;
        }
        const prompt = [
          "请根据以下运行报错日志定位问题并直接给出修复方案，然后在仓库内执行修复。",
          `运行命令：${command || "(未记录)"}`,
          "最近日志：",
          nextTail || "(无)",
        ].join("\n\n");
        onAutoFixRunError(prompt);
        setRunStatusHint("已交给 Claude Code 自动修复");
        message.info("检测到报错，已自动交给 Claude Code 处理。");
      }, 5000);
    });
    const unlistenExit = subscribeTerminalExit((payload) => {
      if (!activeRepository) return;
      if (payload.workspaceId !== String(activeRepository.id) || payload.terminalId !== RUNNER_TERMINAL_ID) return;
      clearIdleTimer();
      clearAutoOpenFallbackTimer();
      const remain = runChunkBufferRef.current.trim();
      if (remain) {
        setRunOutputPreview((prev) => [...prev, { text: remain, isError: RUN_ERROR_REGEX.test(remain) }].slice(-8));
      }
      runChunkBufferRef.current = "";
      setRunStatus("idle");
      setRunStatusHint(payload.exitCode === 0 ? "运行结束" : `已退出（code ${payload.exitCode}）`);
    });
    return () => {
      unlistenOutput();
      unlistenExit();
      clearIdleTimer();
      clearAutoOpenFallbackTimer();
    };
  }, [
    activeRepository,
    appendRunOutputPreview,
    clearAutoOpenFallbackTimer,
    clearIdleTimer,
    normalizeOpenUrl,
    onAutoFixRunError,
    runCommand,
    runCwd,
    runErrorMonitorEnabled,
    runPreferredUrl,
  ]);

  return (
    <div className="app-chat-topbar">
      <div className="app-chat-topbar-drag-region" data-tauri-drag-region>
        <div className={`app-chat-topbar-left ${collapsed ? "app-chat-topbar-left--collapsed" : ""}`}>
          {onToggleSidebar && (
            <TopbarBtn
              icon={<IconCollapseSidebar collapsed={collapsed ?? false} />}
              label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={onToggleSidebar}
            />
          )}
          {activeRepository && (
            <>
              <div className="app-topbar-divider" />
              <Tooltip title="点击复制绝对路径" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  className="app-topbar-repository-trigger"
                  onClick={() => {
                    const path = activeRepository.path.trim();
                    if (!path) {
                      message.warning("暂无仓库路径");
                      return;
                    }
                    void navigator.clipboard.writeText(path).then(
                      () => {
                        message.success("已复制绝对路径");
                      },
                      () => {
                        message.error("复制失败");
                      },
                    );
                  }}
                >
                  <span className="app-topbar-repository-trigger-label">{activeRepository.name}</span>
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <div className="app-chat-topbar-right">
        {activeRepository && (
          <OpenAppMenu
            path={activeRepository.path}
            selectedOpenAppId={selectedOpenAppId}
            onSelectOpenAppId={setSelectedOpenAppId}
          />
        )}
        {onSearch && (
          <TopbarBtn icon={<IconSearch />} label="搜索文件 (Cmd+K)" onClick={onSearch} />
        )}
        <Popover
          trigger={[]}
          placement="bottomRight"
          open={runPopoverOpen}
          onOpenChange={setRunPopoverOpen}
          overlayClassName="app-run-command-popover"
          content={
            <div className="app-run-command-popover__content">
              <div className="app-run-command-popover__title">运行指令</div>
              <Input
                size="small"
                value={runCommand}
                onChange={(event) => setRunCommand(event.target.value)}
                placeholder="例如: bun run dev"
                disabled={!runCwd || runStatus === "stopping"}
                onPressEnter={() => {
                  saveRunCommand();
                }}
              />
              <Input
                size="small"
                value={runPreferredUrl}
                onChange={(event) => setRunPreferredUrl(event.target.value)}
                placeholder="指定打开地址（可选），如 localhost:5173"
                disabled={!runCwd || runStatus === "stopping"}
                onPressEnter={() => {
                  saveRunOpenUrl();
                }}
              />
              <div className="app-run-command-popover__hint">
                日志自动识别仅限 localhost / 本机 IP；已保存指定地址时自动打开始终用该地址。优先级：指定
                &gt; 检测 &gt; 默认
              </div>
              <div className="app-run-command-popover__error-monitor-toggle">
                <Switch size="small" checked={runErrorMonitorEnabled} onChange={setRunErrorMonitorEnabled} />
                <span className="app-run-command-popover__error-monitor-label">AI 报错监控</span>
              </div>
              <div className="app-run-command-popover__status">{runStatusHint}</div>
              {runDetectedUrl ? (
                <button
                  type="button"
                  className="app-run-command-popover__url"
                  onClick={() => void openExternalUrl(resolveOpenUrl())}
                  title={resolveOpenUrl()}
                >
                  打开访问地址：{resolveOpenUrl()}
                </button>
              ) : (
                <button
                  type="button"
                  className="app-run-command-popover__url"
                  onClick={() => void openExternalUrl(resolveOpenUrl())}
                  title={resolveOpenUrl()}
                >
                  打开默认地址：{resolveOpenUrl()}
                </button>
              )}
              {runOutputPreview.length > 0 ? (
                <div className="app-run-command-popover__logs">
                  {runOutputPreview.map((line, index) => (
                    <div
                      key={`${index}-${line.text}`}
                      className={`app-run-command-popover__log-line${line.isError ? " app-run-command-popover__log-line--error" : ""}`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="app-run-command-popover__actions">
                <button
                  type="button"
                  className="app-run-command-popover__btn"
                  onClick={() => setRunPopoverOpen(false)}
                >
                  关闭
                </button>
                <button
                  type="button"
                  className="app-run-command-popover__btn"
                  onClick={saveRunCommand}
                  disabled={!runCwd || runStatus === "stopping"}
                >
                  保存指令
                </button>
                <button
                  type="button"
                  className="app-run-command-popover__btn"
                  onClick={saveRunOpenUrl}
                  disabled={!runCwd || runStatus === "stopping"}
                >
                  保存地址
                </button>
                {runStatus === "running" || runStatus === "stopping" ? (
                  <button
                    type="button"
                    className="app-run-command-popover__btn app-run-command-popover__btn--danger"
                    onClick={() => void stopRun()}
                    disabled={!runCwd || runStatus === "stopping"}
                  >
                    {runStatus === "stopping" ? "停止中..." : "停止"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="app-run-command-popover__btn app-run-command-popover__btn--primary"
                    onClick={() => void startRun()}
                    disabled={!runCwd}
                  >
                    运行
                  </button>
                )}
              </div>
            </div>
          }
        >
          <Tooltip
            title={
              !runCwd
                ? "当前会话未绑定仓库路径，无法运行"
                : runStatus === "running" || runStatus === "stopping"
                  ? "点击停止（右键配置指令）"
                  : "点击运行（右键配置指令）"
            }
            mouseEnterDelay={0.3}
          >
            <span className="app-topbar-run-trigger-wrap">
              <button
                type="button"
                className={`app-topbar-btn app-topbar-btn--run ${runStatus === "running" || runStatus === "stopping" ? "active" : ""}`}
                onClick={handleRunButtonClick}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setRunPopoverOpen(true);
                }}
                disabled={!runCwd}
                aria-label={runStatus === "running" || runStatus === "stopping" ? "停止命令" : "运行命令"}
              >
                {runStatus === "running" || runStatus === "stopping" ? <IconStop /> : <IconPlay />}
              </button>
            </span>
          </Tooltip>
        </Popover>
        {onToggleDualPane && (
          <TopbarBtn
            icon={<IconDualPane />}
            label={
              dualPaneEnabled
                ? "关闭双栏（⌥K）"
                : "双栏：右侧为当前仓库新建一条主会话，与左侧并行执行（快捷键 ⌥K）"
            }
            active={!!dualPaneEnabled}
            onClick={onToggleDualPane}
          />
        )}
        {onToggleTerminal && (
          <TopbarBtn icon={<IconTerminal />} label="终端" active={!terminalCollapsed} onClick={onToggleTerminal} />
        )}
        <div className="app-topbar-divider" />
        {onToggleRightPanel && (
          <TopbarBtn
            icon={<IconRightPanel collapsed={rightCollapsed ?? false} />}
            label={rightCollapsed ? "展开右侧面板" : "收起右侧面板"}
            onClick={onToggleRightPanel}
          />
        )}
      </div>
    </div>
  );
}

// ── ClaudeSessions ──

interface Props {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  activeRepository?: Repository;
  repositories?: Repository[];
  activeRepositoryId?: number | null;
  /**
   * 与 `useWorkspaceMode` 一致的派生形态。`multi_repo` 时面板只展示锚点 path 的项目主会话；
   * `single_repo` 维持历史列表行为。缺省按 `single_repo` 处理（向后兼容）。
   */
  workspaceMode?: WorkspaceMode;
  /** 当 `workspaceMode === "multi_repo"` 时用于解析项目主会话 anchor.path。 */
  activeProject?: ProjectItem | null;
  onSelectRepository?: (id: number) => void;
  onUpdateSessionModel: (sessionId: string, model: string) => void;
  onExecuteSession: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
  onSendMessage: (prompt: string) => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  onCloseSession: (sessionId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: (repository: Repository) => void;
  onRespondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  onDismissQuestion: (sessionId: string) => void;
  onRespondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
  onClearTodos: (sessionId: string) => void;
  onClearFollowups: (sessionId: string) => void;
  onClearRevertItems: (sessionId: string) => void;
  onSendFollowup: (sessionId: string, id: string) => void;
  onRestoreRevert: (sessionId: string, itemId: string) => void | Promise<void>;
  /** 终端运行报错自动修复：创建独立 Claude 会话处理（非主会话） */
  onAutoFixRunError?: (prompt: string) => void | Promise<void>;
  dualPaneEnabled?: boolean;
  onToggleDualPane?: () => void;
  secondarySessionId?: string | null;
  /** 非 null 时右侧主会话绑定到该仓库，否则与侧栏当前仓库一致 */
  dualPaneSecondaryRepositoryId?: number | null;
  onDualPaneSecondaryRepositorySelect?: (repositoryId: number) => void | Promise<void>;
  onNewSecondarySession?: (repository: Repository) => void;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
  onToggleTerminal?: () => void;
  onSearch?: () => void;
  collapsed?: boolean;
  rightCollapsed?: boolean;
  terminalCollapsed?: boolean;
  onOpenWorkflowConfig?: () => void;
  employees?: EmployeeItem[];
  mentionEmployees?: EmployeeItem[];
  composerProjectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  composerHideEmployeesInAtMode?: boolean;
  workflowTasks?: WorkflowTaskItem[];
  onDecideWorkflowTask?: (input: {
    taskId: string;
    employeeId: string;
    decision: "approved" | "rejected";
    reason?: string;
  }) => Promise<void>;
  taskPendingEmployeesByTaskId?: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  workflowGraphStatusByWorkflowId?: Record<string, string>;
  onOpenTaskDetail?: (taskId: string) => void;
  panelBelowMessages?: React.ReactNode;
  hideMessages?: boolean;
  hideSessionTools?: boolean;
  /** 侧栏展示的当前仓库 Claude 槽位剩余（估算），不限制多选条数 */
  taskListConcurrentCapacity?: number;
  /** 按标签会话解析并发槽位，供批量直接 OMC 与主发一致占槽 */
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  /** 与侧栏仓库主会话绑定一致，用于 OMC 批量等挂到固定主标签 */
  repositoryMainBindings?: Record<string, string>;
  /** 将系统消息写入指定 tab 会话（如主会话上的批量 OMC 系统提示） */
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  /** 仅追加用户气泡（不 invoke），用于批量 OMC 展示派发正文 */
  onAppendUserMessage?: (sessionId: string, text: string) => void;
  /** 直连批量 OMC：可执行任务成功标为已完成时，向「OMC员工」标签追加系统提示 */
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
  /** 直连批量 OMC 启动前：清空「OMC员工」该仓库标签并预建新会话，避免沿用 */
  onPrepareFreshOmcEmployeeWorkerForDirectBatch?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
  }) => void | Promise<void>;
  /** 从历史会话弹窗重新扫描当前仓库磁盘上的 Claude 会话 */
  onRefreshHistorySessions?: () => void | Promise<void>;
  /** 历史会话弹窗内删除某条会话（物理删除 jsonl + 内存清理）。运行中状态会被拒绝，由调用方做二次确认。 */
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  /** 直连批量 OMC 进行中（`omcBatchRuntime.active`），供各标签内「OMC员工」空闲判定与监控一致 */
  omcBatchPipelineActive?: boolean;
  /** 工作树弹窗：将 worktree 目录加入当前侧栏项目 */
  onAddWorktreeRepositoryToProject?: (worktreePath: string) => void | Promise<void>;
  /** 从磁盘加载完整 jsonl 覆盖指定标签消息（尾部懒加载后补齐） */
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

export function ClaudeSessions({
  sessions: incomingSessions,
  activeSessionId,
  activeRepository,
  repositories,
  activeRepositoryId,
  workspaceMode = "single_repo",
  activeProject = null,
  onSelectRepository,
  onUpdateSessionModel,
  onExecuteSession,
  onSendMessage,
  onCancelSession,
  onCloseSession: _onCloseSession,
  onSwitchSession,
  onNewSession,
  onRespondToQuestion,
  onDismissQuestion,
  onRespondToPermission,
  onClearTodos,
  onClearFollowups,
  onClearRevertItems,
  onSendFollowup,
  onRestoreRevert,
  dualPaneEnabled = false,
  onToggleDualPane,
  secondarySessionId = null,
  dualPaneSecondaryRepositoryId = null,
  onDualPaneSecondaryRepositorySelect,
  onNewSecondarySession,
  onToggleSidebar,
  onToggleRightPanel,
  onToggleTerminal,
  onSearch,
  collapsed,
  rightCollapsed,
  terminalCollapsed,
  onAutoFixRunError: onAutoFixRunErrorFromProps,
  onOpenWorkflowConfig,
  employees = [],
  mentionEmployees = [],
  composerProjectRoleTagOptions = [],
  composerHideEmployeesInAtMode = false,
  workflowTasks = [],
  taskPendingEmployeesByTaskId = {},
  workflowTemplates = [],
  workflowGraphsByWorkflowId = {},
  workflowGraphStatusByWorkflowId = {},
  onOpenTaskDetail,
  panelBelowMessages,
  hideMessages = false,
  hideSessionTools = false,
  taskListConcurrentCapacity,
  resolveTaskListOmcInvokeConcurrency,
  repositoryMainBindings = {},
  onAppendSystemMessage,
  onAppendUserMessage,
  onNotifyOmcEmployeeDirectBatchTaskDone,
  onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  onRefreshHistorySessions,
  onDeleteHistorySession,
  omcBatchPipelineActive = false,
  onAddWorktreeRepositoryToProject,
  onReloadFullDiskTranscript,
  missionContext,
}: Props) {
  const sessions = useMemo(
    () =>
      filterSessionsForWorkspace({
        sessions: incomingSessions,
        workspaceMode,
        project: activeProject,
        repositories: repositories ?? [],
      }),
    [incomingSessions, workspaceMode, activeProject, repositories],
  );

  const activeSession =
    activeRepository == null
      ? undefined
      : sessions.find((s) => {
          if (s.id !== activeSessionId) return false;
          return (
            resolveRepositoryForSession({
              session: s,
              repositories: repositories ?? [],
              bindings: repositoryMainBindings,
              sessions,
              preferredRepositoryId: activeRepository.id,
            })?.id === activeRepository.id
          );
        });

  const dualPaneSecondaryRepository = useMemo(() => {
    if (!activeRepository) return null;
    if (dualPaneSecondaryRepositoryId == null) {
      return activeRepository;
    }
    return (repositories ?? []).find((r) => r.id === dualPaneSecondaryRepositoryId) ?? activeRepository;
  }, [activeRepository, dualPaneSecondaryRepositoryId, repositories]);

  const secondarySession = useMemo(() => {
    if (!dualPaneEnabled) return undefined;
    const repo = dualPaneSecondaryRepository;
    if (!repo || !secondarySessionId) return undefined;
    return sessions.find((s) => {
      if (s.id !== secondarySessionId) return false;
      return (
        resolveRepositoryForSession({
          session: s,
          repositories: repositories ?? [],
          bindings: repositoryMainBindings,
          sessions,
          preferredRepositoryId: repo.id,
        })?.id === repo.id
      );
    });
  }, [dualPaneEnabled, dualPaneSecondaryRepository, secondarySessionId, sessions, repositories, repositoryMainBindings]);

  const [pendingCollapseNotificationForSessionId, setPendingCollapseNotificationForSessionId] = useState<
    string | null
  >(null);
  const activeSessionWorkflowTasks = useMemo(
    () => workflowTasks.filter((task) => task.creator === activeSession?.id),
    [workflowTasks, activeSession?.id],
  );
  const secondarySessionWorkflowTasks = useMemo(
    () => workflowTasks.filter((task) => task.creator === secondarySession?.id),
    [workflowTasks, secondarySession?.id],
  );

  const handleCreateActiveRepositorySession = useCallback(() => {
    if (!activeRepository) {
      return;
    }
    onNewSession(activeRepository);
  }, [activeRepository, onNewSession]);

  const handleCreateSecondarySession = useCallback(() => {
    const repo = dualPaneSecondaryRepository ?? activeRepository;
    if (!repo || !onNewSecondarySession) {
      return;
    }
    onNewSecondarySession(repo);
  }, [activeRepository, dualPaneSecondaryRepository, onNewSecondarySession]);

  const handleSwitchToSession = useCallback(
    (sessionId: string, options?: { collapseSessionNotificationPanel?: boolean }) => {
      if (options?.collapseSessionNotificationPanel) {
        setPendingCollapseNotificationForSessionId(sessionId);
      }
      const targetSession = sessions.find((item) => item.id === sessionId);
      if (!targetSession) {
        onSwitchSession(sessionId);
        return;
      }
      if (repositories?.length && onSelectRepository) {
        const targetRepository = resolveRepositoryForSession({
          session: targetSession,
          repositories,
          bindings: repositoryMainBindings,
          sessions,
          preferredRepositoryId: activeRepositoryId,
        });
        if (targetRepository && targetRepository.id !== activeRepositoryId) {
          onSelectRepository(targetRepository.id);
        }
      }
      onSwitchSession(sessionId);
    },
    [
      sessions,
      repositories,
      repositoryMainBindings,
      onSelectRepository,
      activeRepositoryId,
      onSwitchSession,
    ],
  );

  useEffect(() => {
    if (
      pendingCollapseNotificationForSessionId !== null &&
      activeSessionId === pendingCollapseNotificationForSessionId
    ) {
      setPendingCollapseNotificationForSessionId(null);
    }
  }, [activeSessionId, pendingCollapseNotificationForSessionId]);

  return (
    <div className="app-claude-sessions">
      {/* Topbar always visible */}
      <Topbar
        activeRepository={activeRepository}
        activeSessionRepositoryPath={activeRepository?.path}
        onToggleSidebar={onToggleSidebar}
        onToggleRightPanel={onToggleRightPanel}
        onToggleTerminal={onToggleTerminal}
        onSearch={onSearch}
        collapsed={collapsed}
        rightCollapsed={rightCollapsed}
        terminalCollapsed={terminalCollapsed}
        onAutoFixRunError={(prompt) => onAutoFixRunErrorFromProps?.(prompt)}
        dualPaneEnabled={dualPaneEnabled}
        onToggleDualPane={onToggleDualPane}
      />

      {/* Session Tabs - 会话标签栏 */}
      {!activeRepository ? (
        <SessionEmptyState
          title="先选择一个工作对象"
          hint="从左侧选择项目或仓库后，这里会显示对应的 Claude 会话。"
          primaryAction={onSearch ? { label: "搜索项目或仓库", onClick: onSearch } : undefined}
        />
      ) : activeSession ? (
        dualPaneEnabled ? (
          <div className="app-claude-sessions__dual-panes">
            <div className="app-claude-sessions__dual-pane">
              <ClaudeSessionChatWithDock
                key={activeSession.id}
                session={activeSession}
                sessions={sessions}
                repositories={repositories}
                activeRepository={activeRepository}
                activeProject={activeProject}
                initialNotificationPanelCollapsed={
                  pendingCollapseNotificationForSessionId === activeSession.id
                }
                onSwitchSession={handleSwitchToSession}
                onCreateNewSession={handleCreateActiveRepositorySession}
                onSend={onSendMessage}
                onExecute={onExecuteSession}
                onSessionModelChange={(model) => onUpdateSessionModel(activeSession.id, model)}
                onCancel={(opts) => onCancelSession(activeSession.id, opts)}
                respondQuestionAt={onRespondToQuestion}
                dismissQuestionAt={onDismissQuestion}
                onRespondToPermission={(response) => onRespondToPermission(activeSession.id, response)}
                onClearTodos={() => onClearTodos(activeSession.id)}
                onClearFollowups={() => onClearFollowups(activeSession.id)}
                onClearRevertItems={() => onClearRevertItems(activeSession.id)}
                onSendFollowup={(id) => onSendFollowup(activeSession.id, id)}
                onRestoreRevert={(id) => onRestoreRevert(activeSession.id, id)}
                onOpenWorkflowConfig={onOpenWorkflowConfig}
                employees={employees}
                mentionEmployees={mentionEmployees}
                projectRoleTagOptions={composerProjectRoleTagOptions}
                hideEmployeesInAtMode={composerHideEmployeesInAtMode}
                workflowTasks={activeSessionWorkflowTasks}
                taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
                workflowTemplates={workflowTemplates}
                workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
                workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
                onOpenTaskDetail={onOpenTaskDetail}
                panelBelowMessages={panelBelowMessages}
                hideMessages={hideMessages}
                hideSessionTools={hideSessionTools}
                taskListConcurrentCapacity={taskListConcurrentCapacity}
                resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
                repositoryMainBindings={repositoryMainBindings}
                onAppendSystemMessage={onAppendSystemMessage}
                onAppendUserMessage={onAppendUserMessage}
                onNotifyOmcEmployeeDirectBatchTaskDone={onNotifyOmcEmployeeDirectBatchTaskDone}
                onPrepareFreshOmcEmployeeWorkerForDirectBatch={onPrepareFreshOmcEmployeeWorkerForDirectBatch}
                onRefreshHistorySessions={onRefreshHistorySessions}
                onDeleteHistorySession={onDeleteHistorySession}
                omcBatchPipelineActive={omcBatchPipelineActive}
                onAddWorktreeRepositoryToProject={onAddWorktreeRepositoryToProject}
                onReloadFullDiskTranscript={onReloadFullDiskTranscript}
                missionContext={missionContext}
              />
            </div>
            <div className="app-claude-sessions__dual-divider" aria-hidden />
            <div className="app-claude-sessions__dual-pane">
              {secondarySession ? (
                <ClaudeSessionChatWithDock
                  key={secondarySession.id}
                  session={secondarySession}
                  sessions={sessions}
                  repositories={repositories}
                  activeRepository={dualPaneSecondaryRepository ?? activeRepository}
                  activeProject={activeProject}
                  initialNotificationPanelCollapsed={
                    pendingCollapseNotificationForSessionId === secondarySession.id
                  }
                  onSwitchSession={handleSwitchToSession}
                  onCreateNewSession={handleCreateSecondarySession}
                  onSend={onSendMessage}
                  onExecute={onExecuteSession}
                  onSessionModelChange={(model) => onUpdateSessionModel(secondarySession.id, model)}
                  onCancel={(opts) => onCancelSession(secondarySession.id, opts)}
                  respondQuestionAt={onRespondToQuestion}
                  dismissQuestionAt={onDismissQuestion}
                  onRespondToPermission={(response) => onRespondToPermission(secondarySession.id, response)}
                  onClearTodos={() => onClearTodos(secondarySession.id)}
                  onClearFollowups={() => onClearFollowups(secondarySession.id)}
                  onClearRevertItems={() => onClearRevertItems(secondarySession.id)}
                  onSendFollowup={(id) => onSendFollowup(secondarySession.id, id)}
                  onRestoreRevert={(id) => onRestoreRevert(secondarySession.id, id)}
                  onOpenWorkflowConfig={onOpenWorkflowConfig}
                  employees={employees}
                  mentionEmployees={mentionEmployees}
                  projectRoleTagOptions={composerProjectRoleTagOptions}
                  hideEmployeesInAtMode={composerHideEmployeesInAtMode}
                  workflowTasks={secondarySessionWorkflowTasks}
                  taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
                  workflowTemplates={workflowTemplates}
                  workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
                  workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
                  onOpenTaskDetail={onOpenTaskDetail}
                  hideMessages={hideMessages}
                  hideSessionTools={hideSessionTools}
                  taskListConcurrentCapacity={taskListConcurrentCapacity}
                  resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
                  repositoryMainBindings={repositoryMainBindings}
                  onAppendSystemMessage={onAppendSystemMessage}
                  onAppendUserMessage={onAppendUserMessage}
                  onNotifyOmcEmployeeDirectBatchTaskDone={onNotifyOmcEmployeeDirectBatchTaskDone}
                  onPrepareFreshOmcEmployeeWorkerForDirectBatch={onPrepareFreshOmcEmployeeWorkerForDirectBatch}
                  onRefreshHistorySessions={onRefreshHistorySessions}
                  onDeleteHistorySession={onDeleteHistorySession}
                  omcBatchPipelineActive={omcBatchPipelineActive}
                  onAddWorktreeRepositoryToProject={onAddWorktreeRepositoryToProject}
                  onReloadFullDiskTranscript={onReloadFullDiskTranscript}
                  dualPaneRepositoryPicker={
                    onDualPaneSecondaryRepositorySelect && activeRepository
                      ? {
                          repositories: repositories ?? [],
                          valueRepositoryId: (dualPaneSecondaryRepository ?? activeRepository).id,
                          onSelectRepositoryId: (id) => {
                            void onDualPaneSecondaryRepositorySelect(id);
                          },
                        }
                      : undefined
                  }
                  missionContext={missionContext}
                />
              ) : (
                <SessionEmptyState
                  title="右侧主会话尚未就绪"
                  hint="当前右侧窗格没有可用会话，可以为选中的仓库重新创建一个主会话。"
                  primaryAction={
                    onNewSecondarySession && (dualPaneSecondaryRepository ?? activeRepository)
                      ? { label: "新建右侧主会话", onClick: handleCreateSecondarySession }
                      : undefined
                  }
                />
              )}
            </div>
          </div>
        ) : (
          <ClaudeSessionChatWithDock
            key={activeSession.id}
            session={activeSession}
            sessions={sessions}
            repositories={repositories}
            activeRepository={activeRepository}
            activeProject={activeProject}
            initialNotificationPanelCollapsed={
              pendingCollapseNotificationForSessionId === activeSession.id
            }
            onSwitchSession={handleSwitchToSession}
            onCreateNewSession={handleCreateActiveRepositorySession}
            onSend={onSendMessage}
            onExecute={onExecuteSession}
            onSessionModelChange={(model) => onUpdateSessionModel(activeSession.id, model)}
            onCancel={(opts) => onCancelSession(activeSession.id, opts)}
            respondQuestionAt={onRespondToQuestion}
            dismissQuestionAt={onDismissQuestion}
            onRespondToPermission={(response) => onRespondToPermission(activeSession.id, response)}
            onClearTodos={() => onClearTodos(activeSession.id)}
            onClearFollowups={() => onClearFollowups(activeSession.id)}
            onClearRevertItems={() => onClearRevertItems(activeSession.id)}
            onSendFollowup={(id) => onSendFollowup(activeSession.id, id)}
            onRestoreRevert={(id) => onRestoreRevert(activeSession.id, id)}
            onOpenWorkflowConfig={onOpenWorkflowConfig}
            employees={employees}
            mentionEmployees={mentionEmployees}
            projectRoleTagOptions={composerProjectRoleTagOptions}
            hideEmployeesInAtMode={composerHideEmployeesInAtMode}
            workflowTasks={activeSessionWorkflowTasks}
            taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
            workflowTemplates={workflowTemplates}
            workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
            workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
            onOpenTaskDetail={onOpenTaskDetail}
            panelBelowMessages={panelBelowMessages}
            hideMessages={hideMessages}
            hideSessionTools={hideSessionTools}
            taskListConcurrentCapacity={taskListConcurrentCapacity}
            resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
            repositoryMainBindings={repositoryMainBindings}
            onAppendSystemMessage={onAppendSystemMessage}
            onAppendUserMessage={onAppendUserMessage}
            onNotifyOmcEmployeeDirectBatchTaskDone={onNotifyOmcEmployeeDirectBatchTaskDone}
            onPrepareFreshOmcEmployeeWorkerForDirectBatch={onPrepareFreshOmcEmployeeWorkerForDirectBatch}
            onRefreshHistorySessions={onRefreshHistorySessions}
            onDeleteHistorySession={onDeleteHistorySession}
            omcBatchPipelineActive={omcBatchPipelineActive}
            onAddWorktreeRepositoryToProject={onAddWorktreeRepositoryToProject}
            onReloadFullDiskTranscript={onReloadFullDiskTranscript}
            missionContext={missionContext}
          />
        )
      ) : (
        <SessionEmptyState
          title="当前仓库还没有可用会话"
          hint="新建会话后可以直接开始对话；已有历史会话会在恢复后出现在这里。"
          primaryAction={{ label: "新建会话", onClick: handleCreateActiveRepositorySession }}
          secondaryAction={onSearch ? { label: "切换工作对象", onClick: onSearch } : undefined}
        />
      )}

      {/* Terminal Panel：按需加载 xterm，避免进入会话页即拉取 terminal-vendor */}
      {!terminalCollapsed && activeRepository && onToggleTerminal && (
        <Suspense
          fallback={
            <div className="app-claude-sessions-terminal-lazy-fallback" role="status" aria-label="终端加载中">
              <Spin size="small" />
            </div>
          }
        >
          <TerminalPanelLazy
            repositoryPath={activeRepository.path}
            repositoryName={activeRepository.name}
            branch={activeRepository.branch}
            dirty={false}
            onClose={onToggleTerminal}
          />
        </Suspense>
      )}
    </div>
  );
}
