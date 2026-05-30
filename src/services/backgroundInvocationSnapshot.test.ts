import { describe, expect, test } from "bun:test";
import {
  clearInvocationSnapshotBundle,
  collectInvocationSnapshotMemoryKeys,
  mergeInvocationSnapshotIntoBundle,
  pruneInvocationSnapshotMemory,
  readInvocationSnapshotBundle,
} from "./backgroundInvocationSnapshot";

describe("backgroundInvocationSnapshot memory cache", () => {
  test("clearInvocationSnapshotBundle drops cached bundle for session key", async () => {
    const sessionId = `sess-${Date.now()}`;
    const repositoryPath = `/tmp/wise-mem-test-${Date.now()}`;

    await mergeInvocationSnapshotIntoBundle(sessionId, repositoryPath, {
      invocationKey: "inv-1",
      phase: "done",
      success: true,
      lineCount: 1,
      errCount: 0,
      stdoutLines: ["ok"],
      stderrLines: [],
      updatedAt: Date.now(),
    });

    const before = await readInvocationSnapshotBundle(sessionId, repositoryPath);
    expect(Object.keys(before.items)).toContain("inv-1");

    await clearInvocationSnapshotBundle(sessionId, repositoryPath);

    const after = await readInvocationSnapshotBundle(sessionId, repositoryPath);
    expect(Object.keys(after.items)).toHaveLength(0);
  });

  test("pruneInvocationSnapshotMemory drops cached bundles for closed sessions", async () => {
    const liveSessionId = "sess-live";
    const closedSessionId = "sess-closed";
    const repositoryPath = `/tmp/wise-mem-prune-${Date.now()}`;

    await mergeInvocationSnapshotIntoBundle(liveSessionId, repositoryPath, {
      invocationKey: "inv-live",
      phase: "done",
      lineCount: 1,
      errCount: 0,
      stdoutLines: ["ok"],
      stderrLines: [],
      updatedAt: Date.now(),
    });
    await mergeInvocationSnapshotIntoBundle(closedSessionId, repositoryPath, {
      invocationKey: "inv-closed",
      phase: "done",
      lineCount: 1,
      errCount: 0,
      stdoutLines: ["bye"],
      stderrLines: [],
      updatedAt: Date.now(),
    });

    const liveKeys = collectInvocationSnapshotMemoryKeys([{ id: liveSessionId, repositoryPath }]);
    pruneInvocationSnapshotMemory(liveKeys);

    const liveBundle = await readInvocationSnapshotBundle(liveSessionId, repositoryPath);
    const closedBundle = await readInvocationSnapshotBundle(closedSessionId, repositoryPath);
    expect(liveBundle.items["inv-live"]).toBeTruthy();
    expect(Object.keys(closedBundle.items)).toHaveLength(0);
  });
});
