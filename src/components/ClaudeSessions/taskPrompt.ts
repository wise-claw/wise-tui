import type { TaskItem } from "../../types";
import { buildTaskExecutionPrompt as buildTaskExecutionPromptImpl } from "./claudeChatHelpers";

export function buildTaskExecutionPrompt(task: TaskItem): string {
  return buildTaskExecutionPromptImpl(task);
}
