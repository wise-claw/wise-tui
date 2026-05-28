import type { ClaudeSession } from "../../types";
import { getSessionPreview } from "./historySessionDrawerChrome";

export function normalizeSearchKeyword(input: string): string {
  return input.trim().toLocaleLowerCase("zh-CN");
}

export function matchSessionByKeyword(session: ClaudeSession, keyword: string, employeeName?: string): boolean {
  if (!keyword) return true;
  const preview = getSessionPreview(session).toLocaleLowerCase("zh-CN");
  const repositoryName = (session.repositoryName ?? "").toLocaleLowerCase("zh-CN");
  const normalizedEmployeeName = (employeeName ?? "").toLocaleLowerCase("zh-CN");
  return preview.includes(keyword) || repositoryName.includes(keyword) || normalizedEmployeeName.includes(keyword);
}

export function sessionUpdatedAt(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
}
