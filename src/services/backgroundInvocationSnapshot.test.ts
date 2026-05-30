import { describe, expect, test } from "bun:test";
import {
  clearInvocationSnapshotBundle,
  mergeInvocationSnapshotIntoBundle,
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
});
