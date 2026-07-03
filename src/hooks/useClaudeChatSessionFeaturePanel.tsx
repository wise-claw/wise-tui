import {
  message,
  Modal,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClaudeChatSessionFeaturePanelProps } from "../components/ClaudeSessions/ClaudeChatSessionFeaturePanel";
import type { ClaudeChatSessionFeatureToolbarProps } from "../components/ClaudeSessions/ClaudeChatSessionFeatureToolbar";
import type { ClaudeChatSessionTraceDrawerProps } from "../components/ClaudeSessions/ClaudeChatSessionTraceDrawer";
import {
  FEATURE_SESSION_LIST_PAGE_SIZE,
  SESSION_SEND_TRACE_PERSIST_MAX,
  type SessionSendTraceEntry,
  type SessionUserQuestionRow,
  type RefreshHistorySessionsScope,
} from "../components/ClaudeSessions/ClaudeChatSessionFeaturePanel";
import {
  isSessionBoundAsRepositoryMain,
} from "../utils/repositoryMainSessionBinding";
import {
  dedupeClaudeSessionsByIdentity,
  listSessionsForHistoryScope,
  resolveHistoryDiskScopePath,
} from "../utils/sessionHistoryScope";
import { resolveProjectMainSessionAnchor } from "../utils/projectSessionAnchor";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { getSessionPreview } from "../components/ClaudeSessions/claudeChatHelpers";
import { getSessionUpdatedAt, groupSessionsByDay, sliceGroupedSessions, type SessionGroup } from "../components/ClaudeSessions/sessionGrouping";
import { isToolOnlyUserMessage, userMessagePlainTextForDisplay, isDisplayNoiseUserMessageText } from "../utils/claudeChatMessageDisplay";
import type {
  ClaudeSession,
  ProjectItem,
  Repository,
} from "../types";
import type { WorkspaceFocus, WorkspaceMode } from "../utils/workspaceMode";
import {
  getSessionTraceStorageKey,
} from "./claudeChatSessionFeaturePanelHelpers";

const EMPTY_HISTORY_GROUPS: SessionGroup[] = [];

export interface UseClaudeChatSessionFeaturePanelInput {
  session: ClaudeSession;
  sessions: ClaudeSession[];
  allSessionsForHistory?: ClaudeSession[];
  repositories: Repository[];
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId?: number | null;
  workspaceMode?: WorkspaceMode;
  repositoryScopePath: string;
  sessionRepository: Repository | null;
  repositoryMainBindings: Record<string, string>;
  hideSessionTools?: boolean;
  scrollToSessionMessageId: (messageId: number) => void;
  onRefreshHistorySessions?: (scope: RefreshHistorySessionsScope) => void | Promise<void>;
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  onOpenRepositoryScheduledTasks?: () => void;
}

export interface UseClaudeChatSessionFeaturePanelResult {
  featurePanelProps: ClaudeChatSessionFeaturePanelProps;
  appendSessionSendTrace: (entry: {
    sessionId: string;
    composerText: string;
    outboundText: string;
    nodes: SessionSendTraceEntry["nodes"];
  }) => void;
}

export function useClaudeChatSessionFeaturePanel(input: UseClaudeChatSessionFeaturePanelInput): UseClaudeChatSessionFeaturePanelResult {
  const {
    session,
    sessions,
    allSessionsForHistory,
    repositories,
    activeRepository: _activeRepository,
    activeProject,
    activeWorkspaceFocus = "repository",
    activeRepositoryId = null,
    workspaceMode = "single_repo",
    repositoryScopePath,
    sessionRepository,
    repositoryMainBindings,
    hideSessionTools = false,
    scrollToSessionMessageId,
    onRefreshHistorySessions,
    onDeleteHistorySession,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    onOpenRepositoryScheduledTasks,
  } = input;

  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [userQuestionsPopoverOpen, setUserQuestionsPopoverOpen] = useState(false);
  const [historySearchText, setHistorySearchText] = useState("");
  const [historyVisibleCount, setHistoryVisibleCount] = useState(FEATURE_SESSION_LIST_PAGE_SIZE);
  const [historySessionsRefreshing, setHistorySessionsRefreshing] = useState(false);
  const historyPopoverScrollRef = useRef<HTMLDivElement>(null);
  const historyLoadMoreRafRef = useRef<number | null>(null);
  const historyLoadMoreLockedRef = useRef(false);
  /** 历史会话删除二次确认 Modal 打开期间，忽略 Popover 的外部点击关闭 */
  const historyPopoverCloseGuardRef = useRef(false);
  const [sessionTraceDrawerOpen, setSessionTraceDrawerOpen] = useState(false);
  const [sessionSendTraces, setSessionSendTraces] = useState<SessionSendTraceEntry[]>([]);

  const historySessionSource = allSessionsForHistory ?? sessions;
    const historyListActive = historyPopoverOpen || historySessionsRefreshing;
    const historyScopeInput = useMemo(
      () => ({
        repositoryScopePath,
        activeProject,
        activeWorkspaceFocus,
        activeRepositoryId: activeRepositoryId ?? sessionRepository?.id ?? null,
        repositories: repositories ?? [],
        workspaceMode,
        repositoryMainBindings,
      }),
      [
        repositoryScopePath,
        activeProject,
        activeWorkspaceFocus,
        activeRepositoryId,
        sessionRepository?.id,
        repositories,
        workspaceMode,
        repositoryMainBindings,
      ],
    );
    const historyDiskScopePath = useMemo(
      () => resolveHistoryDiskScopePath(historyScopeInput),
      [historyScopeInput],
    );
    const repositoryHistorySessions = useMemo(
      () => {
        if (!historyListActive) {
          return [] as ClaudeSession[];
        }
        return dedupeClaudeSessionsByIdentity(
          listSessionsForHistoryScope(historySessionSource, historyScopeInput),
        ).sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a));
      },
      [historyListActive, historySessionSource, historyScopeInput],
    );
    const repositoryHistorySessionsForDisplay = useMemo(
      () => {
        if (!historyListActive) {
          return [] as ClaudeSession[];
        }
        return repositoryHistorySessions.filter((item) => {
          if (item.messages.length > 0) {
            return true;
          }
          return Boolean(item.diskPreview?.trim());
        });
      },
      [historyListActive, repositoryHistorySessions],
    );

    const filteredHistorySessions = useMemo(() => {
      if (!historyListActive) {
        return [] as ClaudeSession[];
      }
      const keyword = historySearchText.trim().toLocaleLowerCase("zh-CN");
      if (!keyword) {
        return repositoryHistorySessionsForDisplay;
      }
      return repositoryHistorySessionsForDisplay.filter((item) => {
        const preview = getSessionPreview(item).toLocaleLowerCase("zh-CN");
        const repositoryName = item.repositoryName.toLocaleLowerCase("zh-CN");
        return preview.includes(keyword) || repositoryName.includes(keyword);
      });
    }, [historyListActive, repositoryHistorySessionsForDisplay, historySearchText]);

    const filteredHistoryLengthRef = useRef(0);
    filteredHistoryLengthRef.current = filteredHistorySessions.length;

    const groupedHistorySessionsAll = useMemo(
      () => {
        if (!historyListActive) {
          return EMPTY_HISTORY_GROUPS;
        }
        return groupSessionsByDay(filteredHistorySessions);
      },
      [historyListActive, filteredHistorySessions],
    );
    const groupedHistorySessions = useMemo(
      () => {
        if (!historyListActive) {
          return EMPTY_HISTORY_GROUPS;
        }
        return sliceGroupedSessions(groupedHistorySessionsAll, historyVisibleCount);
      },
      [historyListActive, groupedHistorySessionsAll, historyVisibleCount],
    );

    const canRestoreHistorySession = useCallback(
      (targetSession: ClaudeSession) => {
        if (!onRestoreHistorySessionAsMain) return false;
        return !isSessionBoundAsRepositoryMain(targetSession, repositoryMainBindings, sessions, repositories ?? []);
      },
      [onRestoreHistorySessionAsMain, repositoryMainBindings, sessions, repositories],
    );

    const historyRefreshInFlightRef = useRef(false);
    const handleHistorySessionsRefresh = useCallback(() => {
      if (!onRefreshHistorySessions || historyRefreshInFlightRef.current) return;
      const scopePath = historyDiskScopePath.trim();
      if (!scopePath) return;
      historyRefreshInFlightRef.current = true;
      setHistorySessionsRefreshing(true);
      void Promise.resolve(
        onRefreshHistorySessions({
          repositoryPath: scopePath,
          repositoryName:
            activeWorkspaceFocus === "project" && activeProject
              ? resolveProjectMainSessionAnchor(activeProject, repositories ?? []).displayName.trim() ||
                session.repositoryName.trim() ||
                scopePath
              : sessionRepository?.name?.trim() || session.repositoryName.trim() || scopePath,
        }),
      )
        .catch(() => {
          message.error("刷新历史会话失败");
        })
        .finally(() => {
          historyRefreshInFlightRef.current = false;
          setHistorySessionsRefreshing(false);
        });
    }, [
      historyDiskScopePath,
      onRefreshHistorySessions,
      activeWorkspaceFocus,
      activeProject,
      repositories,
      session.repositoryName,
      sessionRepository?.name,
    ]);

    /**
     * 历史会话弹窗内删除一条会话：先 `Modal.confirm` 二次确认，再调 hook 的 `deleteSession`。
     *
     * 注意：物理删除 jsonl 不可恢复；后端 IPC 抛错（如运行中拒绝）时仅 toast 提示，
     * 不抹掉本地 tab，让用户先取消运行再重试。
     */
    const releaseHistoryPopoverCloseGuard = useCallback(() => {
      // 延后解除，避免蒙层/按钮点击在同一事件循环里误关历史 Popover
      window.setTimeout(() => {
        historyPopoverCloseGuardRef.current = false;
      }, 0);
    }, []);

    const handleDeleteHistorySession = useCallback(
      (sessionId: string, previewText: string) => {
        if (!onDeleteHistorySession) return;
        const preview = (previewText || "").trim() || "(无预览)";
        historyPopoverCloseGuardRef.current = true;
        Modal.confirm({
          title: "删除该历史会话？",
          content: (
            <div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "var(--ant-color-text-tertiary)" }}>预览：</span>
                <span>{preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}</span>
              </div>
              <div style={{ color: "var(--ant-color-error)" }}>
                将删除磁盘上的 Claude Code 会话记录（jsonl），不可恢复。
                请确保该会话未在其他终端或 Claude CLI 中打开。
              </div>
            </div>
          ),
          okText: "删除",
          okType: "danger",
          cancelText: "取消",
          autoFocusButton: "cancel",
          mask: { closable: true },
          onCancel: releaseHistoryPopoverCloseGuard,
          afterClose: releaseHistoryPopoverCloseGuard,
          onOk: async () => {
            try {
              await onDeleteHistorySession(sessionId);
            } catch (err) {
              const text = err instanceof Error ? err.message : String(err ?? "");
              message.error(text || "删除历史会话失败");
              throw err;
            }
          },
        });
      },
      [onDeleteHistorySession, releaseHistoryPopoverCloseGuard],
    );


  useEffect(() => {
    setHistoryVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
  }, [historySearchText]);

  useEffect(() => {
    historyLoadMoreLockedRef.current = false;
  }, [historyVisibleCount, filteredHistorySessions.length, historyPopoverOpen]);

    useEffect(() => {
      if (!historyPopoverOpen) return;
      const el = historyPopoverScrollRef.current;
      if (!el) return;
      const tryLoadMore = () => {
        const max = filteredHistoryLengthRef.current;
        if (max <= 0) return;
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        if (!nearBottom) {
          historyLoadMoreLockedRef.current = false;
          return;
        }
        if (historyLoadMoreLockedRef.current) {
          return;
        }
        historyLoadMoreLockedRef.current = true;
        setHistoryVisibleCount((n) => {
          const next = Math.min(n + FEATURE_SESSION_LIST_PAGE_SIZE, max);
          if (next === n) {
            historyLoadMoreLockedRef.current = false;
          }
          return next;
        });
      };
      const handler = () => {
        if (historyLoadMoreRafRef.current !== null) return;
        historyLoadMoreRafRef.current = window.requestAnimationFrame(() => {
          historyLoadMoreRafRef.current = null;
          tryLoadMore();
        });
      };
      tryLoadMore();
      el.addEventListener("scroll", handler, { passive: true });
      return () => {
        el.removeEventListener("scroll", handler);
        if (historyLoadMoreRafRef.current !== null) {
          window.cancelAnimationFrame(historyLoadMoreRafRef.current);
          historyLoadMoreRafRef.current = null;
        }
      };
    }, [historyPopoverOpen, filteredHistorySessions.length]);

    useEffect(() => {
      return () => {
        if (historyLoadMoreRafRef.current !== null) {
          window.cancelAnimationFrame(historyLoadMoreRafRef.current);
          historyLoadMoreRafRef.current = null;
        }
      };
    }, []);
    const sessionUserQuestions = useMemo((): SessionUserQuestionRow[] => {
      if (!userQuestionsPopoverOpen) {
        return [];
      }
      const rows: SessionUserQuestionRow[] = [];
      for (const m of session.messages) {
        if (m.role !== "user" || isToolOnlyUserMessage(m)) continue;
        const text = userMessagePlainTextForDisplay(m).trim();
        if (!text) continue;
        // 过滤 CLI 注入的压缩/命令输出、压缩恢复 summary、AskUserQuestion 已作答标记，
        // 这些都不是用户真实输入，不应出现在「历史消息」提问历史里。
        if (isDisplayNoiseUserMessageText(text)) continue;
        rows.push({ id: m.id, text, timestamp: m.timestamp });
      }
      rows.sort((a, b) => b.timestamp - a.timestamp);
      return rows;
    }, [userQuestionsPopoverOpen, session.messages]);
    const sessionTraceStorageKey = getSessionTraceStorageKey(session.id, session.repositoryPath);
    const tracePersistTimerRef = useRef<number | null>(null);

    useEffect(() => {
      if (!sessionTraceDrawerOpen) {
        setSessionSendTraces([]);
        return;
      }
      let cancelled = false;
      void (async () => {
        const raw = await getAppSetting(sessionTraceStorageKey);
        if (cancelled) return;
        if (!raw) {
          setSessionSendTraces([]);
          return;
        }
        try {
          const parsed = JSON.parse(raw) as SessionSendTraceEntry[];
          if (!Array.isArray(parsed)) {
            setSessionSendTraces([]);
            return;
          }
          setSessionSendTraces(parsed.slice(0, SESSION_SEND_TRACE_PERSIST_MAX));
        } catch {
          setSessionSendTraces([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [sessionTraceDrawerOpen, sessionTraceStorageKey]);
    useEffect(() => {
      if (tracePersistTimerRef.current != null) {
        window.clearTimeout(tracePersistTimerRef.current);
      }
      tracePersistTimerRef.current = window.setTimeout(() => {
        void setAppSetting(sessionTraceStorageKey, JSON.stringify(sessionSendTraces.slice(0, SESSION_SEND_TRACE_PERSIST_MAX)));
        tracePersistTimerRef.current = null;
      }, 600);
      return () => {
        if (tracePersistTimerRef.current != null) {
          window.clearTimeout(tracePersistTimerRef.current);
          tracePersistTimerRef.current = null;
        }
      };
    }, [sessionSendTraces, sessionTraceStorageKey]);

  useEffect(() => {
    if (!hideSessionTools) {
      return;
    }
    setHistoryPopoverOpen(false);
    setHistorySearchText("");
  }, [hideSessionTools]);

  const traceDrawerWidth = Math.min(620, typeof window !== "undefined" ? window.innerWidth - 24 : 620);

  const closeSessionTraceDrawer = useCallback(() => {
    setSessionTraceDrawerOpen(false);
  }, []);

  const appendSessionSendTrace = useCallback(
    (entry: {
      sessionId: string;
      composerText: string;
      outboundText: string;
      nodes: SessionSendTraceEntry["nodes"];
    }) => {
      if (entry.sessionId !== session.id) return;
      const traceItem: SessionSendTraceEntry = {
        id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: entry.sessionId,
        createdAt: Date.now(),
        composerText: entry.composerText,
        outboundText: entry.outboundText,
        nodes: entry.nodes,
      };
      setSessionSendTraces((prev) => [traceItem, ...prev].slice(0, SESSION_SEND_TRACE_PERSIST_MAX));
    },
    [session.id],
  );

  const toolbarProps = useMemo((): ClaudeChatSessionFeatureToolbarProps => ({
    sessionId: session.id,
    sessionUserQuestions,
    historyPopoverOpen,
    setHistoryPopoverOpen,
    historyPopoverCloseGuardRef,
    setHistoryVisibleCount,
    handleHistorySessionsRefresh,
    historySearchText,
    setHistorySearchText,
    onRefreshHistorySessions,
    historySessionsRefreshing,
    groupedHistorySessions,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    canRestoreHistorySession,
    onDeleteHistorySession,
    handleDeleteHistorySession,
    historyPopoverScrollRef,
    userQuestionsPopoverOpen,
    setUserQuestionsPopoverOpen,
    scrollToSessionMessageId,
    onOpenRepositoryScheduledTasks,
  }), [
    session.id,
    sessionUserQuestions,
    historyPopoverOpen,
    historyPopoverCloseGuardRef,
    handleHistorySessionsRefresh,
    historySearchText,
    onRefreshHistorySessions,
    historySessionsRefreshing,
    groupedHistorySessions,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    canRestoreHistorySession,
    onDeleteHistorySession,
    handleDeleteHistorySession,
    historyPopoverScrollRef,
    userQuestionsPopoverOpen,
    scrollToSessionMessageId,
    onOpenRepositoryScheduledTasks,
  ]);

  const traceDrawerProps = useMemo((): ClaudeChatSessionTraceDrawerProps | null => {
    if (!sessionTraceDrawerOpen) {
      return null;
    }
    return {
      open: true,
      onClose: closeSessionTraceDrawer,
      traceDrawerWidth,
      sessionId: session.id,
      sessionRepositoryPath: session.repositoryPath,
      sessionSendTraces,
      setSessionSendTraces,
    };
  }, [
    sessionTraceDrawerOpen,
    closeSessionTraceDrawer,
    traceDrawerWidth,
    session.id,
    session.repositoryPath,
    sessionSendTraces,
  ]);

  const featurePanelProps = useMemo((): ClaudeChatSessionFeaturePanelProps => ({
    toolbar: toolbarProps,
    traceDrawer: traceDrawerProps,
  }), [toolbarProps, traceDrawerProps]);

  return { featurePanelProps, appendSessionSendTrace };
}
