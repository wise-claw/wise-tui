import { describe, expect, test } from "bun:test";
import {
  SCHEDULED_TASK_RETRY_BUSY,
  SCHEDULED_TASK_SKIP_CRON,
  buildScheduledTaskResultPatch,
  evaluateScheduledTaskGate,
  formatScheduledTaskLastKindLabel,
  nextScheduledFireMs,
  resolveScheduledTaskLastKind,
  summarizeScheduledTaskKinds,
} from "./scheduledTaskReliability";

describe("evaluateScheduledTaskGate", () => {
  const dueCron = "* * * * *";
  const lastSlot = Date.parse("2026-01-01T00:00:00Z");
  const now = lastSlot + 120_000;

  test("disabled tasks never fire", () => {
    expect(
      evaluateScheduledTaskGate({
        enabled: false,
        cronExpression: dueCron,
        lastScheduledSlotAt: lastSlot,
        nowMs: now,
        pausedGlobal: false,
        pausedRepository: false,
      }),
    ).toEqual({ status: "disabled" });
  });

  test("global pause holds the slot without consuming it", () => {
    expect(
      evaluateScheduledTaskGate({
        enabled: true,
        cronExpression: dueCron,
        lastScheduledSlotAt: lastSlot,
        nowMs: now,
        pausedGlobal: true,
        pausedRepository: false,
      }),
    ).toEqual({ status: "paused", scope: "global" });
  });

  test("repository pause holds the slot", () => {
    expect(
      evaluateScheduledTaskGate({
        enabled: true,
        cronExpression: dueCron,
        lastScheduledSlotAt: lastSlot,
        nowMs: now,
        pausedGlobal: false,
        pausedRepository: true,
      }).status,
    ).toBe("paused");
  });

  test("invalid cron is visible instead of silent continue", () => {
    expect(
      evaluateScheduledTaskGate({
        enabled: true,
        cronExpression: "not-a-cron",
        lastScheduledSlotAt: lastSlot,
        nowMs: now,
        pausedGlobal: false,
        pausedRepository: false,
      }),
    ).toEqual({ status: "invalid_cron" });
    expect(nextScheduledFireMs("", lastSlot)).toBe("invalid");
  });

  test("future slots stay on hold", () => {
    const gate = evaluateScheduledTaskGate({
      enabled: true,
      cronExpression: "0 9 * * *",
      lastScheduledSlotAt: now,
      nowMs: now,
      pausedGlobal: false,
      pausedRepository: false,
    });
    expect(gate.status).toBe("hold");
  });

  test("busy retry leaves the same slot due on the next tick", () => {
    const lastSlot = Date.parse("2026-01-01T00:00:00Z");
    const now = lastSlot + 120_000;
    const due = evaluateScheduledTaskGate({
      enabled: true,
      cronExpression: "* * * * *",
      lastScheduledSlotAt: lastSlot,
      nowMs: now,
      pausedGlobal: false,
      pausedRepository: false,
    });
    expect(due.status).toBe("due");
    const nextFireMs = due.status === "due" ? due.nextFireMs : lastSlot;
    const patch = buildScheduledTaskResultPatch({
      nextFireMs,
      nowMs: now,
      consumeSlot: false,
      kind: "retrying",
      message: SCHEDULED_TASK_RETRY_BUSY,
    });
    const again = evaluateScheduledTaskGate({
      enabled: true,
      cronExpression: "* * * * *",
      lastScheduledSlotAt: patch.lastScheduledSlotAt ?? lastSlot,
      nowMs: now + 45_000,
      pausedGlobal: false,
      pausedRepository: false,
    });
    expect(again.status).toBe("due");
    if (again.status === "due") expect(again.nextFireMs).toBe(nextFireMs);
  });
});

describe("buildScheduledTaskResultPatch", () => {
  test("busy retry does not consume the cron slot", () => {
    const patch = buildScheduledTaskResultPatch({
      nextFireMs: 100,
      nowMs: 200,
      consumeSlot: false,
      kind: "retrying",
      message: SCHEDULED_TASK_RETRY_BUSY,
    });
    expect(patch.lastScheduledSlotAt).toBeUndefined();
    expect(patch.lastExecuteKind).toBe("retrying");
    expect(patch.lastExecuteOk).toBe(false);
    expect(patch.lastExecuteMessage).toBe(SCHEDULED_TASK_RETRY_BUSY);
  });

  test("config skip consumes the slot so it will not loop every tick", () => {
    const patch = buildScheduledTaskResultPatch({
      nextFireMs: 100,
      nowMs: 200,
      consumeSlot: true,
      kind: "skipped",
      message: SCHEDULED_TASK_SKIP_CRON,
    });
    expect(patch.lastScheduledSlotAt).toBe(100);
    expect(patch.lastExecuteKind).toBe("skipped");
  });

  test("success consumes the slot", () => {
    const patch = buildScheduledTaskResultPatch({
      nextFireMs: 100,
      nowMs: 200,
      consumeSlot: true,
      kind: "ok",
    });
    expect(patch.lastScheduledSlotAt).toBe(100);
    expect(patch.lastExecuteOk).toBe(true);
    expect(patch.lastExecuteKind).toBe("ok");
  });

  test("consuming a overdue slot catch-up-ones to the latest past fire", () => {
    const lastSlot = Date.parse("2026-01-01T00:00:00Z");
    const due = lastSlot + 60_000;
    const now = lastSlot + 10 * 60_000;
    const patch = buildScheduledTaskResultPatch({
      nextFireMs: due,
      nowMs: now,
      consumeSlot: true,
      kind: "ok",
      cronExpression: "* * * * *",
    });
    expect(patch.lastScheduledSlotAt).toBeGreaterThan(due);
    expect(patch.lastScheduledSlotAt).toBeLessThanOrEqual(now);
    const again = evaluateScheduledTaskGate({
      enabled: true,
      cronExpression: "* * * * *",
      lastScheduledSlotAt: patch.lastScheduledSlotAt,
      nowMs: now,
      pausedGlobal: false,
      pausedRepository: false,
    });
    expect(again.status).toBe("hold");
  });
});

describe("resolveScheduledTaskLastKind", () => {
  test("prefers explicit kind and falls back to lastExecuteOk", () => {
    expect(resolveScheduledTaskLastKind({ lastExecuteKind: "retrying", lastExecuteOk: false, lastExecutedAt: 1 })).toBe(
      "retrying",
    );
    expect(resolveScheduledTaskLastKind({ lastExecuteOk: false, lastExecutedAt: 1 })).toBe("failed");
    expect(resolveScheduledTaskLastKind({ lastExecuteOk: true, lastExecutedAt: 1 })).toBe("ok");
    expect(resolveScheduledTaskLastKind({})).toBeNull();
    expect(formatScheduledTaskLastKindLabel("retrying")).toBe("待补跑");
    expect(formatScheduledTaskLastKindLabel("skipped")).toBe("已跳过");
  });

  test("summarize counts retrying and skipped separately from failed", () => {
    expect(
      summarizeScheduledTaskKinds([
        { lastExecuteKind: "failed", lastExecutedAt: 1 },
        { lastExecuteOk: false, lastExecutedAt: 1 },
        { lastExecuteKind: "skipped", lastExecutedAt: 1 },
        { lastExecuteKind: "retrying", lastExecutedAt: 1 },
        { lastExecuteKind: "ok", lastExecutedAt: 1 },
      ]),
    ).toEqual({ failed: 2, skipped: 1, retrying: 1 });
  });
});
