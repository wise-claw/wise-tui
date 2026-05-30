import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import {
  capWorkflowInvocationStreamDetailsForMemory,
  digestOmcDirectBatchInvocationsList,
  parsePersistedOmcDirectBatchInvocationRow,
  serializeOmcDirectBatchInvocationForPersistence,
  trimRepositoryMemberInvocationMap,
} from "./omcDirectBatchInvocationsPersistence";

describe("omcDirectBatchInvocationsPersistence", () => {
  test("keeps repository member attribution in persisted invocation rows", () => {
    const row: WorkflowInvocationStreamDetail = {
      phase: "started",
      invocationKey: "inv-1",
      sessionId: "session-1",
      repositoryPath: "/repo/frontend",
      omcInvocationSource: "direct_batch",
      taskId: "task-1",
      templateId: "trellis",
      ownerKind: "repository",
      ownerRepositoryId: 7,
      ownerRepositoryName: "frontend app",
      ownerRepositoryPath: "/repo/frontend",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
      lineCount: 3,
      errCount: 0,
    };

    const slim = serializeOmcDirectBatchInvocationForPersistence(row);
    const parsed = parsePersistedOmcDirectBatchInvocationRow(slim);

    expect(parsed).toMatchObject({
      ownerKind: "repository",
      ownerRepositoryId: 7,
      ownerRepositoryName: "frontend app",
      ownerRepositoryPath: "/repo/frontend",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
    });
  });

  test("digest changes when repository member attribution changes", () => {
    const base: WorkflowInvocationStreamDetail = {
      phase: "started",
      invocationKey: "inv-1",
      sessionId: "session-1",
      repositoryPath: "/repo/frontend",
      templateId: "trellis",
      lineCount: 1,
      errCount: 0,
    };

    expect(
      digestOmcDirectBatchInvocationsList([{ ...base, ownerRepositoryId: 7, subagentType: "trellis-implement" }]),
    ).not.toBe(
      digestOmcDirectBatchInvocationsList([{ ...base, ownerRepositoryId: 8, subagentType: "trellis-check" }]),
    );
  });

  test("trimRepositoryMemberInvocationMap keeps running and drops oldest completed", () => {
    const map = new Map<string, WorkflowInvocationStreamDetail>();
    map.set("run-1", {
      phase: "started",
      invocationKey: "run-1",
      sessionId: "s1",
      repositoryPath: "/r",
      attempt: 99,
    });
    for (let i = 0; i < 50; i += 1) {
      map.set(`done-${i}`, {
        phase: "complete",
        invocationKey: `done-${i}`,
        sessionId: "s1",
        repositoryPath: "/r",
        attempt: i,
      });
    }
    trimRepositoryMemberInvocationMap(map, 10);
    expect(map.has("run-1")).toBe(true);
    expect(map.size).toBe(10);
    expect(map.has("done-49")).toBe(true);
    expect(map.has("done-0")).toBe(false);
  });

  test("capWorkflowInvocationStreamDetailsForMemory preserves running rows", () => {
    const list: WorkflowInvocationStreamDetail[] = [
      { phase: "started", invocationKey: "a", sessionId: "s", repositoryPath: "/r" },
      ...Array.from({ length: 60 }, (_, i) => ({
        phase: "complete" as const,
        invocationKey: `c-${i}`,
        sessionId: "s",
        repositoryPath: "/r",
        attempt: i,
      })),
    ];
    const capped = capWorkflowInvocationStreamDetailsForMemory(list, 5);
    expect(capped.filter((row) => row.phase !== "complete")).toHaveLength(1);
    expect(capped).toHaveLength(5);
  });
});
