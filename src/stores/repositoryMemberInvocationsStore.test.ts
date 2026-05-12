import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import {
  getRepositoryMemberInvocationsSnapshot,
  resetRepositoryMemberInvocationsStore,
  setRepositoryMemberInvocationsStore,
  subscribeRepositoryMemberInvocations,
} from "./repositoryMemberInvocationsStore";

describe("repositoryMemberInvocationsStore", () => {
  test("stores trellis repository member invocation snapshots", () => {
    resetRepositoryMemberInvocationsStore();
    let notified = 0;
    const unsubscribe = subscribeRepositoryMemberInvocations(() => {
      notified += 1;
    });
    const row: WorkflowInvocationStreamDetail = {
      phase: "started",
      invocationKey: "inv-1",
      sessionId: "session-1",
      repositoryPath: "/repo/frontend",
      templateId: "trellis",
      taskId: "task-1",
      ownerKind: "repository",
      ownerRepositoryId: 7,
      ownerRepositoryName: "frontend app",
      ownerRepositoryPath: "/repo/frontend",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
    };

    setRepositoryMemberInvocationsStore([row], "digest-1");

    expect(getRepositoryMemberInvocationsSnapshot()).toEqual([row]);
    expect(notified).toBe(1);
    unsubscribe();
    resetRepositoryMemberInvocationsStore();
  });
});
