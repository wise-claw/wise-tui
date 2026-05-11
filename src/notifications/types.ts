import type { PermissionRequest, QuestionRequest, TodoItem } from "../types";

/** 单条追问建议（Composer Dock） */
export interface FollowupItem {
  id: string;
  text: string;
}

/** 单条回滚提示（Composer Dock） */
export interface RevertItem {
  id: string;
  text: string;
}

/** 每个标签页会话一条桶（key = ClaudeSession.id） */
export interface SessionNotificationBucket {
  todos: TodoItem[];
  followupItems: FollowupItem[];
  revertItems: RevertItem[];
  /** 当前展示在 Composer 的选择题（队首） */
  questionRequest: QuestionRequest | null;
  /**
   * 同一标签上尚未展示的多道 AskUserQuestion（FIFO）。
   * 主会话 / 员工独立会话 / 团队流程各自独立桶；并行流式时也可能在同一桶内连续到达多题。
   */
  questionRequestQueue: QuestionRequest[];
  permissionRequest: PermissionRequest | null;
}

/** 供 Composer 使用的切片（与迁移前 useClaudeSessions 返回形状对齐） */
export interface SessionDockSlice {
  todos: TodoItem[];
  followupItems: FollowupItem[];
  revertItems: RevertItem[];
  questionRequest: QuestionRequest | null;
  questionRequestQueue: QuestionRequest[];
  permissionRequest: PermissionRequest | null;
}

export type ControlRequestKind = "question" | "permission";
export type ControlRequestStatus = "pending" | "answered" | "failed" | "expired";

export interface ControlRequestLifecycle {
  requestId: string;
  sessionId: string;
  kind: ControlRequestKind;
  status: ControlRequestStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}
