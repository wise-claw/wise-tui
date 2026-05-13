import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import {
  digestOmcDirectBatchInvocationsList,
  parsePersistedOmcDirectBatchInvocationRow,
  serializeOmcDirectBatchInvocationForPersistence,
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
});
