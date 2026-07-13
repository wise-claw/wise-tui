/**
 * 会话级通知桶（Phase 1）：流式助手文本 → todo / followup / revert；
 * question / permission 占位，后续由流解析写入。
 */

import type { PermissionRequest, QuestionRequest, TodoItem } from "../types";
import type {
  ControlRequestKind,
  ControlRequestLifecycle,
  FollowupItem,
  RevertItem,
  SessionDockSlice,
  SessionNotificationBucket,
} from "./types";
import { mergePermissionRequestUpdate } from "./permissionIngest";
import { mergeTodoLists, todosSnapshotEqual } from "./todoIngest";

function emptyBucket(): SessionNotificationBucket {
  return {
    todos: [],
    followupItems: [],
    revertItems: [],
    questionRequest: null,
    questionRequestQueue: [],
    permissionRequest: null,
  };
}

const EMPTY_SLICE: SessionDockSlice = {
  todos: [],
  followupItems: [],
  revertItems: [],
  questionRequest: null,
  questionRequestQueue: [],
  permissionRequest: null,
};

const MAX_FOLLOWUP_ITEMS_PER_SESSION = 20;
const MAX_REVERT_ITEMS_PER_SESSION = 12;
const MAX_QUESTION_QUEUE_PER_SESSION = 8;

/**
 * 内容签名（不含 id / arrivedAt）：用于把同一 AskUserQuestion 在 `assistant.tool_use` 与 `sdk_control_request`
 * 两条独立流上写来的不同 request_id 合并为一项题卡。
 */
function questionContentSig(q: QuestionRequest): string {
  const opts = q.options.map((o) => `${o.label.trim()}\u0001${(o.value ?? "").trim()}`).join("\u0002");
  return `${q.question.trim()}\u0003${q.multiSelect ? "1" : "0"}\u0003${opts}`;
}

function questionRequestIdPriority(requestId: string): number {
  const id = requestId.trim().toLowerCase();
  // Claude assistant tool_use id（如 toolu_xxx）通常不是 stdin control_response 期望的 request_id。
  if (id.startsWith("toolu_") || id.startsWith("tool_")) return 0;
  // control_request / sdk_control_request 的 request_id 优先保留。
  return 1;
}

function preferIncomingQuestionRequest(current: QuestionRequest, incoming: QuestionRequest): boolean {
  const cp = questionRequestIdPriority(current.id);
  const ip = questionRequestIdPriority(incoming.id);
  if (ip !== cp) return ip > cp;
  // 同优先级时保留最新到达，允许后续通道补齐内容。
  return true;
}

/** 合并两道流式桶上的 AskUserQuestion，按队首→队尾去重，避免 tab id 迁移时丢题 */
function mergeQuestionRacks(to: SessionNotificationBucket, from: SessionNotificationBucket): void {
  const seenIds = new Set<string>();
  const seenSigs = new Set<string>();
  const ordered: QuestionRequest[] = [];
  const push = (q: QuestionRequest | null | undefined) => {
    if (!q) return;
    if (seenIds.has(q.id)) return;
    const sig = questionContentSig(q);
    if (seenSigs.has(sig)) return;
    seenIds.add(q.id);
    seenSigs.add(sig);
    ordered.push(q);
  };
  push(to.questionRequest);
  for (const x of to.questionRequestQueue ?? []) push(x);
  push(from.questionRequest);
  for (const x of from.questionRequestQueue ?? []) push(x);
  to.questionRequest = ordered[0] ?? null;
  to.questionRequestQueue = ordered.slice(1);
}

function mergeTodos(a: TodoItem[], b: TodoItem[]): TodoItem[] {
  return mergeTodoLists(a, b, true);
}

function mergeFollowups(a: FollowupItem[], b: FollowupItem[]): FollowupItem[] {
  const seen = new Set(a.map((x) => x.text));
  const out = [...a];
  for (const x of b) {
    if (!seen.has(x.text)) {
      seen.add(x.text);
      out.push(x);
    }
  }
  return out.slice(-MAX_FOLLOWUP_ITEMS_PER_SESSION);
}

function mergeReverts(a: RevertItem[], b: RevertItem[]): RevertItem[] {
  const seen = new Set(a.map((x) => x.text));
  const out = [...a];
  for (const x of b) {
    if (!seen.has(x.text)) {
      seen.add(x.text);
      out.push(x);
    }
  }
  return out.slice(-MAX_REVERT_ITEMS_PER_SESSION);
}

const MAX_LIFECYCLE_ENTRIES = 500;

class NotificationHub {
  private buckets = new Map<string, SessionNotificationBucket>();
  private requestLifecycles = new Map<string, ControlRequestLifecycle>();
  private listeners = new Set<() => void>();
  private version = 0;
  /** 仅用于 `useDockSlice`：某「标签/viewer」的 Dock 展示变化时递增，避免双栏时左右栏互相牵连重渲染。 */
  private dockSliceGenBySession = new Map<string, number>();
  private dockListenersBySession = new Map<string, Set<() => void>>();
  /**
   * 主会话发起到员工子会话时：流式仍写入子会话桶，但主会话 Composer 需展示 AskUserQuestion / Permission。
   * viewerSessionId（如主标签）→ control 数据读自 sourceSessionId（如员工标签）。
   */
  private controlDockMirrorViewerToSource = new Map<string, string>();
  private controlDockMirrorSourceToViewers = new Map<string, Set<string>>();

  private bumpGlobal() {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  /**
   * 存储桶在 `storageSessionId` 上变化时，凡 `getDockSlice(viewerId)` 会读到该桶的 viewer 都要刷新
   *（自身 + 以该桶为 control 镜像源的 viewer）。
   */
  private bumpDockForStorageSession(storageSessionId: string) {
    const touched = new Set<string>([storageSessionId]);
    const viewers = this.controlDockMirrorSourceToViewers.get(storageSessionId);
    if (viewers) {
      for (const v of viewers) touched.add(v);
    }
    for (const id of touched) {
      this.dockSliceGenBySession.set(id, (this.dockSliceGenBySession.get(id) ?? 0) + 1);
      this.dockListenersBySession.get(id)?.forEach((l) => l());
    }
  }

  /** 迁移等难以逐会话推导时：只唤醒当前已有 `subscribeDockSlice` 的会话（通常即活动标签/双栏两路）。 */
  private bumpDockForAllSubscribedSessions() {
    for (const id of this.dockListenersBySession.keys()) {
      this.dockSliceGenBySession.set(id, (this.dockSliceGenBySession.get(id) ?? 0) + 1);
      this.dockListenersBySession.get(id)?.forEach((l) => l());
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  subscribeDockSlice = (sessionId: string, listener: () => void) => {
    let set = this.dockListenersBySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.dockListenersBySession.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.dockListenersBySession.delete(sessionId);
      }
    };
  };

  getDockSliceGeneration = (sessionId: string) => this.dockSliceGenBySession.get(sessionId) ?? 0;

  private upsertRequestLifecycle(
    requestId: string,
    sessionId: string,
    kind: ControlRequestKind,
    status: ControlRequestLifecycle["status"],
    lastError?: string,
  ) {
    const now = Date.now();
    const prev = this.requestLifecycles.get(requestId);
    this.requestLifecycles.set(requestId, {
      requestId,
      sessionId,
      kind,
      status,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      // 重新进入 pending 时清掉旧 lastError，避免新题仍显示「进程已结束」等过期文案
      lastError:
        lastError !== undefined ? lastError : status === "pending" ? undefined : prev?.lastError,
    });
  }

  private getOrCreate(sessionId: string): SessionNotificationBucket {
    let b = this.buckets.get(sessionId);
    if (!b) {
      b = emptyBucket();
      this.buckets.set(sessionId, b);
    }
    return b;
  }

  private controlBucketForViewer(sessionId: string): SessionNotificationBucket | undefined {
    const src = this.controlDockMirrorViewerToSource.get(sessionId);
    if (!src || src === sessionId) return this.buckets.get(sessionId);
    return this.buckets.get(src) ?? this.buckets.get(sessionId);
  }

  /**
   * 从主会话输入框 @员工 派发时：在主标签上展示子会话流里的 AskUserQuestion / Permission（仍向子会话 stdin 回包）。
   * @param viewerSessionId 当前发起来源标签（通常主会话）
   * @param sourceSessionId 流式归属标签（员工独立会话）；传 null 清除镜像
   */
  setControlDockMirror(viewerSessionId: string | null, sourceSessionId: string | null) {
    if (!viewerSessionId?.trim()) return;
    const v = viewerSessionId.trim();
    const prevSrc = this.controlDockMirrorViewerToSource.get(v);
    if (prevSrc) {
      this.controlDockMirrorSourceToViewers.get(prevSrc)?.delete(v);
      if (this.controlDockMirrorSourceToViewers.get(prevSrc)?.size === 0) {
        this.controlDockMirrorSourceToViewers.delete(prevSrc);
      }
    }
    this.controlDockMirrorViewerToSource.delete(v);
    const s = sourceSessionId?.trim() ?? "";
    if (!s || s === v) {
      this.bumpGlobal();
      this.bumpDockForStorageSession(v);
      return;
    }
    this.controlDockMirrorViewerToSource.set(v, s);
    if (!this.controlDockMirrorSourceToViewers.has(s)) {
      this.controlDockMirrorSourceToViewers.set(s, new Set());
    }
    this.controlDockMirrorSourceToViewers.get(s)!.add(v);
    this.bumpGlobal();
    this.bumpDockForStorageSession(v);
    this.bumpDockForStorageSession(s);
  }

  private migrateControlDockMirrorKeys(fromId: string, toId: string) {
    const viewersOfFrom = this.controlDockMirrorSourceToViewers.get(fromId);
    if (viewersOfFrom && viewersOfFrom.size > 0) {
      this.controlDockMirrorSourceToViewers.delete(fromId);
      const merged = this.controlDockMirrorSourceToViewers.get(toId) ?? new Set();
      for (const viewer of viewersOfFrom) {
        this.controlDockMirrorViewerToSource.set(viewer, toId);
        merged.add(viewer);
      }
      this.controlDockMirrorSourceToViewers.set(toId, merged);
    }
    if (this.controlDockMirrorViewerToSource.has(fromId)) {
      const src = this.controlDockMirrorViewerToSource.get(fromId)!;
      this.controlDockMirrorViewerToSource.delete(fromId);
      this.controlDockMirrorViewerToSource.set(toId, src);
      this.controlDockMirrorSourceToViewers.get(src)?.delete(fromId);
      let sv = this.controlDockMirrorSourceToViewers.get(src);
      if (!sv) {
        sv = new Set();
        this.controlDockMirrorSourceToViewers.set(src, sv);
      }
      sv.add(toId);
    }
  }

  private stripControlDockMirrorsInvolving(sessionId: string) {
    if (this.controlDockMirrorViewerToSource.has(sessionId)) {
      const src = this.controlDockMirrorViewerToSource.get(sessionId)!;
      this.controlDockMirrorViewerToSource.delete(sessionId);
      this.controlDockMirrorSourceToViewers.get(src)?.delete(sessionId);
      if (this.controlDockMirrorSourceToViewers.get(src)?.size === 0) {
        this.controlDockMirrorSourceToViewers.delete(src);
      }
    }
    const viewers = this.controlDockMirrorSourceToViewers.get(sessionId);
    if (viewers) {
      for (const v of viewers) {
        this.controlDockMirrorViewerToSource.delete(v);
      }
      this.controlDockMirrorSourceToViewers.delete(sessionId);
    }
  }

  getDockSlice(sessionId: string | null): SessionDockSlice {
    if (!sessionId) return EMPTY_SLICE;
    const bSelf = this.buckets.get(sessionId);
    const bCtrl = this.controlBucketForViewer(sessionId);
    if (!bSelf && !bCtrl) return EMPTY_SLICE;
    const todos = bSelf?.todos ?? [];
    const followupItems = bSelf?.followupItems ?? [];
    const revertItems = bSelf?.revertItems ?? [];
    const qBucket = bCtrl ?? bSelf!;
    return {
      todos,
      followupItems,
      revertItems,
      questionRequest: qBucket.questionRequest,
      questionRequestQueue: qBucket.questionRequestQueue ?? [],
      permissionRequest: qBucket.permissionRequest,
    };
  }

  /** 角标只计「仍可操作」的权限/选择题；已过期/失败的不占角标。 */
  private controlRequestCountsAsPending(requestId: string | undefined): boolean {
    if (!requestId?.trim()) return false;
    const st = this.requestLifecycles.get(requestId)?.status;
    return st === "pending" || st === undefined;
  }

  /** Phase 2：会话标签角标（阻塞项 + 未完成 todo + 追问 + 回滚提示） */
  getPendingCount(sessionId: string): number {
    const bSelf = this.buckets.get(sessionId);
    const bCtrl = this.controlBucketForViewer(sessionId);
    if (!bSelf && !bCtrl) return 0;
    let n = 0;
    const ctrl = bCtrl ?? bSelf;
    if (ctrl?.permissionRequest && this.controlRequestCountsAsPending(ctrl.permissionRequest.id)) n += 1;
    if (ctrl?.questionRequest && this.controlRequestCountsAsPending(ctrl.questionRequest.id)) n += 1;
    for (const q of ctrl?.questionRequestQueue ?? []) {
      if (this.controlRequestCountsAsPending(q.id)) n += 1;
    }
    if (bSelf) {
      n += bSelf.followupItems.length;
      n += bSelf.revertItems.length;
      n += bSelf.todos.filter((t) => t.status !== "completed").length;
    }
    return n;
  }

  /** 解析助手文本中的 Dock 线索（与原先 parseDockFromOutput 行为一致） */
  ingestStreamAssistText(sessionId: string, text: string) {
    if (!sessionId || !text) return;
    const b = this.getOrCreate(sessionId);
    let changed = false;

    const todoRegex = /^-\s+\[([ x-])\]\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    const foundTodos: TodoItem[] = [];
    while ((match = todoRegex.exec(text)) !== null) {
      const status = match[1] === "x" ? "completed" : match[1] === "-" ? "in_progress" : "pending";
      foundTodos.push({ id: `todo_${match[2].slice(0, 20)}`, content: match[2], status });
    }
    if (foundTodos.length > 0) {
      const byContent = new Map(b.todos.map((t) => [t.content.trim(), t]));
      for (const ft of foundTodos) {
        const key = ft.content.trim();
        const prev = byContent.get(key);
        if (!prev) {
          byContent.set(key, ft);
          changed = true;
        } else if (prev.status !== ft.status) {
          byContent.set(key, { ...prev, id: prev.id, status: ft.status });
          changed = true;
        }
      }
      if (changed) {
        b.todos = [...byContent.values()];
      }
    }

    const followupRegex = /^(?:💡\s*|Suggestion:|Follow-up:)\s*(.+)$/gim;
    const followups: FollowupItem[] = [];
    while ((match = followupRegex.exec(text)) !== null) {
      followups.push({ id: `followup_${Date.now()}_${match[1].slice(0, 10)}`, text: match[1].trim() });
    }
    if (followups.length > 0) {
      const existingTexts = new Set(b.followupItems.map((f) => f.text));
      const newItems = followups.filter((f) => !existingTexts.has(f.text));
      if (newItems.length > 0) {
        b.followupItems = [...b.followupItems, ...newItems].slice(-MAX_FOLLOWUP_ITEMS_PER_SESSION);
        changed = true;
      }
    }

    const revertRegex = /^(?:↩\s*|Revert:|Restore point:)\s*(.+)$/gim;
    const reverts: RevertItem[] = [];
    while ((match = revertRegex.exec(text)) !== null) {
      reverts.push({ id: `revert_${Date.now()}`, text: match[1].trim() });
    }
    if (reverts.length > 0) {
      const existingTexts = new Set(b.revertItems.map((r) => r.text));
      const newItems = reverts.filter((r) => !existingTexts.has(r.text));
      if (newItems.length > 0) {
        b.revertItems = [...b.revertItems, ...newItems].slice(-MAX_REVERT_ITEMS_PER_SESSION);
        changed = true;
      }
    }

    if (changed) {
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  /** stream-json init：临时 tab id → Claude session_id */
  migrateSessionKey(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId) return;
    const from = this.buckets.get(fromId);
    if (!from) return;
    this.buckets.delete(fromId);
    const to = this.buckets.get(toId);
    if (!to) {
      this.buckets.set(toId, from);
      this.bumpGlobal();
      this.bumpDockForAllSubscribedSessions();
      return;
    }
    to.todos = mergeTodos(to.todos, from.todos);
    to.followupItems = mergeFollowups(to.followupItems, from.followupItems);
    to.revertItems = mergeReverts(to.revertItems, from.revertItems);
    mergeQuestionRacks(to, from);
    to.permissionRequest = to.permissionRequest ?? from.permissionRequest;
    for (const [requestId, lifecycle] of this.requestLifecycles.entries()) {
      if (lifecycle.sessionId === fromId) {
        this.requestLifecycles.set(requestId, { ...lifecycle, sessionId: toId, updatedAt: Date.now() });
      }
    }
    this.migrateControlDockMirrorKeys(fromId, toId);
    this.bumpGlobal();
    this.bumpDockForAllSubscribedSessions();
  }

  removeSession(sessionId: string) {
    this.stripControlDockMirrorsInvolving(sessionId);
    let changed = false;
    for (const [requestId, lifecycle] of this.requestLifecycles.entries()) {
      if (lifecycle.sessionId === sessionId && lifecycle.status === "pending") {
        this.requestLifecycles.set(requestId, { ...lifecycle, status: "expired", updatedAt: Date.now() });
        changed = true;
      }
    }
    if (this.buckets.delete(sessionId)) {
      this.bumpGlobal();
      this.bumpDockForAllSubscribedSessions();
    } else if (changed) {
      this.bumpGlobal();
      this.bumpDockForAllSubscribedSessions();
    }
    this.dockListenersBySession.delete(sessionId);
    this.dockSliceGenBySession.delete(sessionId);
  }

  /** 应用 TodoWrite 工具结果；merge=false 时整表替换。 */
  applyTodoWrite(sessionId: string, items: TodoItem[], merge: boolean) {
    if (!sessionId || items.length === 0) return;
    const b = this.getOrCreate(sessionId);
    const next = merge ? mergeTodoLists(b.todos, items, true) : items;
    if (todosSnapshotEqual(next, b.todos)) return;
    b.todos = next;
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  toggleTodoItem(sessionId: string, todoId: string) {
    if (!sessionId || !todoId) return;
    const b = this.buckets.get(sessionId);
    if (!b) return;
    const idx = b.todos.findIndex((t) => t.id === todoId);
    if (idx < 0) return;
    const current = b.todos[idx];
    const nextStatus: TodoItem["status"] =
      current.status === "pending"
        ? "in_progress"
        : current.status === "in_progress"
          ? "completed"
          : "pending";
    if (current.status === nextStatus) return;
    const next = [...b.todos];
    next[idx] = { ...current, status: nextStatus };
    b.todos = next;
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  /** 从 transcript 恢复 Dock（Hub 为空时，例如重开会话或刷新后）。 */
  restoreTodosFromTranscript(sessionId: string, items: TodoItem[], merge: boolean) {
    if (!sessionId || items.length === 0) return;
    const b = this.buckets.get(sessionId);
    if (b && b.todos.length > 0) return;
    this.applyTodoWrite(sessionId, items, merge);
  }

  clearTodos(sessionId: string | null) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (b && b.todos.length > 0) {
      b.todos = [];
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  /** 会话轮次成功结束后，将仍未勾选的 todo 标记为 completed（Agent 常遗漏最终 TodoWrite）。 */
  completeRemainingTodos(sessionId: string) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (!b || b.todos.length === 0) return;
    let changed = false;
    const next = b.todos.map((item) => {
      if (item.status === "completed") return item;
      changed = true;
      return { ...item, status: "completed" as const };
    });
    if (!changed) return;
    b.todos = next;
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  clearFollowups(sessionId: string | null) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (b && b.followupItems.length > 0) {
      b.followupItems = [];
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  clearRevertItems(sessionId: string | null) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (b && b.revertItems.length > 0) {
      b.revertItems = [];
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  removeFollowupItem(sessionId: string | null, itemId: string) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (!b) return;
    const next = b.followupItems.filter((f) => f.id !== itemId);
    if (next.length !== b.followupItems.length) {
      b.followupItems = next;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  removeRevertItem(sessionId: string | null, itemId: string) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (!b) return;
    const next = b.revertItems.filter((r) => r.id !== itemId);
    if (next.length !== b.revertItems.length) {
      b.revertItems = next;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  clearQuestion(sessionId: string | null) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (!b?.questionRequest) return;
    this.upsertRequestLifecycle(b.questionRequest.id, sessionId, "question", "answered");
    b.questionRequest = b.questionRequestQueue.shift() ?? null;
    if (b.questionRequest) {
      this.upsertRequestLifecycle(b.questionRequest.id, sessionId, "question", "pending");
    }
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  /**
   * 用户点击「关闭」：去掉队首已过期/失败/已答等非 pending 的题（不写 stdin），并展示队列中下一道待处理题。
   * 数据仍在 `questionRequest` 桶内、且队首仍为 pending 时不会改动（请用跳过/提交）。
   */
  userDismissNonPendingQuestionHeadAt(storageSessionId: string | null) {
    if (!storageSessionId) return;
    const b = this.buckets.get(storageSessionId);
    if (!b?.questionRequest) return;
    this.discardNonPendingQuestionHeads(b);
    if (b.questionRequest) {
      this.upsertRequestLifecycle(b.questionRequest.id, storageSessionId, "question", "pending");
    }
    this.bumpGlobal();
    this.bumpDockForStorageSession(storageSessionId);
  }

  /**
   * 子进程已退出或 stdin 映射被回收时调用：将仍为 pending 的 lifecycle 标为 expired。
   * - `clear`：清空桶内 AskUserQuestion / Permission（新一轮对话、显式清理）。
   * - `expire_keep_visible`：单轮 `claude-complete` 时保留当前题/权限对象，便于用户看到题干与选项（已过期），
   *   避免「流里已有 tool_use、Hub 刚写入就被 complete 清掉」导致 Dock 永远不出现。
   */
  invalidateControlRequestsForSession(
    sessionId: string | null,
    reason = "进程已结束",
    mode: "clear" | "expire_keep_visible" = "clear",
  ) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (!b) return;
    const expireIfPending = (requestId: string | undefined) => {
      if (!requestId) return;
      const prev = this.requestLifecycles.get(requestId);
      if (prev?.status === "pending") {
        this.requestLifecycles.set(requestId, {
          ...prev,
          status: "expired",
          updatedAt: Date.now(),
          lastError: reason,
        });
      }
    };
    expireIfPending(b.questionRequest?.id);
    for (const q of b.questionRequestQueue ?? []) expireIfPending(q.id);
    expireIfPending(b.permissionRequest?.id);

    if (mode === "expire_keep_visible") {
      b.questionRequestQueue = [];
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }

    b.questionRequest = null;
    b.questionRequestQueue = [];
    b.permissionRequest = null;
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  clearPermission(sessionId: string | null) {
    if (!sessionId) return;
    const b = this.buckets.get(sessionId);
    if (b?.permissionRequest) {
      this.upsertRequestLifecycle(b.permissionRequest.id, sessionId, "permission", "answered");
      b.permissionRequest = null;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
    }
  }

  /**
   * 丢掉队首已不是 pending 的旧题（如单轮 complete 后 expire_keep_visible 留在头上的过期题），
   * 否则下一道 AskUserQuestion 只会进队列尾部，界面仍顶着上一道，看起来像「还在用上次的题/答案」。
   */
  private discardNonPendingQuestionHeads(b: SessionNotificationBucket) {
    while (b.questionRequest) {
      const st = this.requestLifecycles.get(b.questionRequest.id)?.status;
      if (st === "pending" || st === undefined) break;
      b.questionRequest = b.questionRequestQueue.shift() ?? null;
    }
  }

  /** 供测试或 Phase 3 流解析写入；同一会话多题时入队，避免主/子会话并行时互相覆盖 */
  setQuestionRequest(sessionId: string, q: QuestionRequest | null) {
    const b = this.getOrCreate(sessionId);
    if (!q) {
      b.questionRequest = null;
      b.questionRequestQueue = [];
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    this.discardNonPendingQuestionHeads(b);
    this.upsertRequestLifecycle(q.id, sessionId, "question", "pending");
    if (!b.questionRequestQueue) b.questionRequestQueue = [];
    const newSig = questionContentSig(q);
    const head = b.questionRequest;
    if (!head) {
      b.questionRequest = q;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    if (head.id === q.id) {
      b.questionRequest = q;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    // 内容签名相同但 id 不同：同一 AskUserQuestion 经 `assistant.tool_use` 与 `sdk_control_request` 双通道到达，
    // 用最新 payload 覆盖（让 control_response 使用最新 request_id，旧 id 标 answered 防止角标残留）。
    if (questionContentSig(head) === newSig) {
      if (preferIncomingQuestionRequest(head, q)) {
        this.upsertRequestLifecycle(head.id, sessionId, "question", "answered");
        b.questionRequest = q;
      } else {
        this.upsertRequestLifecycle(q.id, sessionId, "question", "answered");
      }
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    const qi = b.questionRequestQueue.findIndex((x) => x.id === q.id);
    if (qi >= 0) {
      b.questionRequestQueue = [...b.questionRequestQueue];
      b.questionRequestQueue[qi] = q;
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    const qiBySig = b.questionRequestQueue.findIndex((x) => questionContentSig(x) === newSig);
    if (qiBySig >= 0) {
      const replaced = b.questionRequestQueue[qiBySig]!;
      b.questionRequestQueue = [...b.questionRequestQueue];
      if (preferIncomingQuestionRequest(replaced, q)) {
        this.upsertRequestLifecycle(replaced.id, sessionId, "question", "answered");
        b.questionRequestQueue[qiBySig] = q;
      } else {
        this.upsertRequestLifecycle(q.id, sessionId, "question", "answered");
      }
      this.bumpGlobal();
      this.bumpDockForStorageSession(sessionId);
      return;
    }
    b.questionRequestQueue = [...b.questionRequestQueue, q].slice(-MAX_QUESTION_QUEUE_PER_SESSION);
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  setPermissionRequest(sessionId: string, p: PermissionRequest | null) {
    const b = this.getOrCreate(sessionId);
    if (p) {
      const merged = mergePermissionRequestUpdate(b.permissionRequest, p);
      const lc = this.requestLifecycles.get(merged.id);

      // 同 id 已是 answered / expired / failed：
      //   - 拒绝把 lifecycle 降级回 pending（避免「自动批准成功后」被流里
      //     后续增量 plan / 二次 control_request 复活 dock）。
      //   - 不再覆盖桶内容，避免 docked 状态被早期快照翻回导致 render 抖动。
      // 跨 id 的新请求仍按新事件重写（典型：用户新对话触发了不同的工具请求）。
      // 注意：仅当桶中已有同 id 时才抑制；首写入时 lc 不存在或为 pending，
      // 走原有 upsertRequestLifecycle(..., "pending") 路径正常建立新请求。
      if (lc && lc.status !== "pending" && b.permissionRequest?.id === merged.id) {
        return;
      }

      if (
        b.permissionRequest &&
        b.permissionRequest.id === merged.id &&
        b.permissionRequest.description === merged.description &&
        b.permissionRequest.tool === merged.tool &&
        b.permissionRequest.controlSubtype === merged.controlSubtype &&
        b.permissionRequest.toolUseId === merged.toolUseId
      ) {
        return;
      }
      this.upsertRequestLifecycle(merged.id, sessionId, "permission", "pending");
      b.permissionRequest = merged;
    } else {
      b.permissionRequest = null;
    }
    this.bumpGlobal();
    this.bumpDockForStorageSession(sessionId);
  }

  findRequestSessionId(requestId: string): string | null {
    return this.requestLifecycles.get(requestId)?.sessionId ?? null;
  }

  markRequestFailed(requestId: string, error: string) {
    const prev = this.requestLifecycles.get(requestId);
    if (!prev) return;
    this.requestLifecycles.set(requestId, {
      ...prev,
      status: "failed",
      updatedAt: Date.now(),
      lastError: error,
    });
    this.bumpGlobal();
    this.bumpDockForStorageSession(prev.sessionId);
  }

  markRequestAnswered(requestId: string) {
    const prev = this.requestLifecycles.get(requestId);
    if (!prev) return;
    this.requestLifecycles.set(requestId, {
      ...prev,
      status: "answered",
      updatedAt: Date.now(),
      lastError: undefined,
    });
    this.bumpGlobal();
    this.bumpDockForStorageSession(prev.sessionId);
  }

  getRequestLifecycle(requestId: string): ControlRequestLifecycle | null {
    return this.requestLifecycles.get(requestId) ?? null;
  }

  expireStaleRequests(maxAgeMs: number) {
    if (maxAgeMs <= 0) return;
    const now = Date.now();
    let changed = false;
    for (const [requestId, lifecycle] of this.requestLifecycles.entries()) {
      if (lifecycle.status !== "pending") continue;
      if (now - lifecycle.updatedAt < maxAgeMs) continue;
      this.requestLifecycles.set(requestId, {
        ...lifecycle,
        status: "expired",
        updatedAt: now,
      });
      changed = true;
    }
    const pruneBefore = now - maxAgeMs * 2;
    for (const [requestId, lifecycle] of [...this.requestLifecycles.entries()]) {
      if (lifecycle.status === "pending") continue;
      if (lifecycle.updatedAt >= pruneBefore) continue;
      this.requestLifecycles.delete(requestId);
      changed = true;
    }
    // Count-based cap: remove oldest non-pending entries when exceeding limit
    const nonPendingEntries = [...this.requestLifecycles.entries()]
      .filter(([, lc]) => lc.status !== "pending")
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    if (nonPendingEntries.length > MAX_LIFECYCLE_ENTRIES) {
      const toRemove = nonPendingEntries.length - MAX_LIFECYCLE_ENTRIES;
      for (let i = 0; i < toRemove; i++) {
        this.requestLifecycles.delete(nonPendingEntries[i]![0]);
        changed = true;
      }
    }
    if (changed) {
      this.bumpGlobal();
      this.bumpDockForAllSubscribedSessions();
    }
  }

  /**
   * 枚举各会话桶队首 AskUserQuestion（不含已答），供同仓库多标签在 Composer 用 Tabs 聚合展示。
   */
  listHeadQuestionDockEntries(): Array<{ ownerSessionId: string; question: QuestionRequest }> {
    const out: Array<{ ownerSessionId: string; question: QuestionRequest }> = [];
    for (const [ownerSessionId, b] of this.buckets) {
      if (!b?.questionRequest) continue;
      const lc = this.requestLifecycles.get(b.questionRequest.id);
      if (lc?.status === "answered") continue;
      out.push({ ownerSessionId, question: b.questionRequest });
    }
    return out;
  }

  /** 磁盘索引裁剪 / 关标签后，清掉已无对应 Claude 标签的通知桶。 */
  pruneOrphanSessions(liveSessionIds: ReadonlySet<string>): void {
    for (const sessionId of [...this.buckets.keys()]) {
      if (!liveSessionIds.has(sessionId)) {
        this.removeSession(sessionId);
      }
    }
    for (const sessionId of [...this.dockSliceGenBySession.keys()]) {
      if (!liveSessionIds.has(sessionId) && !this.dockListenersBySession.has(sessionId)) {
        this.dockSliceGenBySession.delete(sessionId);
      }
    }
    for (const sessionId of [...this.controlDockMirrorViewerToSource.keys()]) {
      if (!liveSessionIds.has(sessionId)) {
        this.stripControlDockMirrorsInvolving(sessionId);
      }
    }
    for (const sessionId of [...this.controlDockMirrorSourceToViewers.keys()]) {
      if (!liveSessionIds.has(sessionId)) {
        this.stripControlDockMirrorsInvolving(sessionId);
      }
    }
    for (const [requestId, lifecycle] of [...this.requestLifecycles.entries()]) {
      if (liveSessionIds.has(lifecycle.sessionId)) continue;
      if (lifecycle.status === "pending") continue;
      this.requestLifecycles.delete(requestId);
    }
  }
}

export const notificationHub = new NotificationHub();
