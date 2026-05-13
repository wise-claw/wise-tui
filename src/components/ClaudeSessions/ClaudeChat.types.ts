import type { ClaudeSession, TaskFlowStatus, TaskItem } from "../../types";

export interface SessionGroup {
  key: string;
  label: string;
  items: ClaudeSession[];
}

export type TaskPromptTask = TaskItem;
export type SplitTaskFlowStatus = TaskFlowStatus;
