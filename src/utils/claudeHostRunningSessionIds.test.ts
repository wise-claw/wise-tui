import { describe, expect, it } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildClaudeSessionIdToLivePids,
  collectRunningClaudeSessionIdsFromHostProcesses,
  hostProcessPathsCorrelate,
  isClaudeSessionIdRunningByHostPid,
  isClaudeSessionRunningByHostProcesses,
} from "./claudeHostRunningSessionIds";

function hostSession(
  repositoryPath: string,
  claudeSessionId: string | null,
): Pick<ClaudeSession, "repositoryPath" | "claudeSessionId"> {
  return { repositoryPath, claudeSessionId };
}

describe("claudeHostRunningSessionIds", () => {
  const processes = [
    { pid: 100, memoryBytes: 0, sessionId: "sid-a", projectPath: null, sessionSource: "resume_arg" },
    { pid: 101, memoryBytes: 0, sessionId: "sid-a", projectPath: null, sessionSource: "resume_arg" },
    { pid: 200, memoryBytes: 0, sessionId: null, projectPath: "/p", sessionSource: "lsof_jsonl" },
  ] as const;

  it("maps session id to live pids from process scan only", () => {
    const map = buildClaudeSessionIdToLivePids(processes);
    expect(map.get("sid-a")).toEqual([100, 101]);
    expect(map.has("sid-b")).toBe(false);
  });

  it("collectRunningClaudeSessionIdsFromHostProcesses ignores rows without session id", () => {
    const ids = collectRunningClaudeSessionIdsFromHostProcesses(processes);
    expect(ids.has("sid-a")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("isClaudeSessionIdRunningByHostPid requires matching pid-bearing process row", () => {
    expect(isClaudeSessionIdRunningByHostPid("sid-a", processes)).toBe(true);
    expect(isClaudeSessionIdRunningByHostPid("sid-b", processes)).toBe(false);
    expect(isClaudeSessionIdRunningByHostPid(null, processes)).toBe(false);
  });

  it("hostProcessPathsCorrelate accepts same path or nested workspace roots", () => {
    expect(hostProcessPathsCorrelate("/work/hr/web", "/work/hr/web")).toBe(true);
    expect(hostProcessPathsCorrelate("/work/hr", "/work/hr/web")).toBe(true);
    expect(hostProcessPathsCorrelate("/work/hr/web", "/work/other")).toBe(false);
  });

  it("isClaudeSessionRunningByHostProcesses matches pid by path when process session id is missing", () => {
    expect(
      isClaudeSessionRunningByHostProcesses(
        hostSession("/work/p", "sid-a"),
        [{ pid: 200, memoryBytes: 0, sessionId: null, projectPath: "/work/p", sessionSource: "lsof_jsonl" }],
      ),
    ).toBe(true);
  });

  it("isClaudeSessionRunningByHostProcesses rejects conflicting session ids at same path", () => {
    expect(
      isClaudeSessionRunningByHostProcesses(
        hostSession("/work/p", "sid-a"),
        [{ pid: 200, memoryBytes: 0, sessionId: "sid-b", projectPath: "/work/p", sessionSource: "lsof_jsonl" }],
      ),
    ).toBe(false);
  });
});
