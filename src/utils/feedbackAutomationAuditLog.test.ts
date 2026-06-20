import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import {
  __resetFeedbackAutomationAuditCacheForTest,
  appendFeedbackAutomationAudit,
  clearFeedbackAutomationAudit,
  formatFeedbackAutomationAuditEntry,
  formatFeedbackAutomationAuditSummary,
  listFeedbackAutomationAudit,
  loadAllFeedbackAutomationAudit,
} from "./feedbackAutomationAuditLog";

function makePatch(overrides: Partial<FeedbackConfigPatch> = {}): FeedbackConfigPatch {
  return {
    id: "patch-1",
    kind: "claude_md",
    action: "append_section",
    path: "CLAUDE.md",
    section: "纪律",
    rationale: "测试补丁",
    content: "- 条目",
    source: "ai",
    status: "pending",
    ...overrides,
  };
}

function installLocalStorageStub(): Storage {
  const map = new Map<string, string>();
  const stub = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: stub },
    configurable: true,
  });
  return stub;
}

beforeEach(() => {
  installLocalStorageStub();
  __resetFeedbackAutomationAuditCacheForTest();
});

afterEach(() => {
  clearFeedbackAutomationAudit();
  __resetFeedbackAutomationAuditCacheForTest();
  // @ts-expect-error 清理测试注入的 window stub
  delete globalThis.window;
});

describe("feedbackAutomationAuditLog / append & list", () => {
  test("append derives patchId and patchKey from patch", () => {
    const entry = appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "auto_apply",
      reason: "低风险自动应用",
      patch: makePatch(),
    });
    expect(entry.patchId).toBe("patch-1");
    expect(entry.patchKey).toContain("claude_md");
    expect(entry.patchKey).toContain("CLAUDE.md");
    expect(entry.outcome).toBe("success");

    const all = listFeedbackAutomationAudit("/repo/a");
    expect(all.length).toBe(1);
    expect(all[0]?.id).toBe(entry.id);
  });

  test("list filters by repository path", () => {
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "auto_apply",
      reason: "a1",
      patch: makePatch({ id: "p-a" }),
    });
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/b",
      action: "auto_rollback",
      reason: "b1",
      patch: makePatch({ id: "p-b", path: "B.md" }),
    });
    expect(listFeedbackAutomationAudit("/repo/a").length).toBe(1);
    expect(listFeedbackAutomationAudit("/repo/b").length).toBe(1);
    expect(listFeedbackAutomationAudit().length).toBe(2);
  });

  test("entries are newest-first", () => {
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "auto_apply",
      reason: "first",
      patch: makePatch({ id: "p-1" }),
    });
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "guard_block",
      reason: "second",
      patch: makePatch({ id: "p-2", path: "second.md" }),
    });
    const all = listFeedbackAutomationAudit("/repo/a");
    expect(all[0]?.action).toBe("guard_block");
    expect(all[1]?.action).toBe("auto_apply");
  });
});

describe("feedbackAutomationAuditLog / clear", () => {
  test("clear with repo only removes that repo", () => {
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "auto_apply",
      reason: "a",
      patch: makePatch({ id: "p-a" }),
    });
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/b",
      action: "auto_apply",
      reason: "b",
      patch: makePatch({ id: "p-b", path: "b.md" }),
    });
    clearFeedbackAutomationAudit("/repo/a");
    expect(listFeedbackAutomationAudit("/repo/a").length).toBe(0);
    expect(listFeedbackAutomationAudit("/repo/b").length).toBe(1);
  });

  test("clear without repo removes all", () => {
    appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "auto_apply",
      reason: "a",
      patch: makePatch({ id: "p-a" }),
    });
    clearFeedbackAutomationAudit();
    expect(loadAllFeedbackAutomationAudit().length).toBe(0);
  });
});

describe("feedbackAutomationAuditLog / formatting", () => {
  test("formatFeedbackAutomationAuditEntry includes label, outcome, key, reason", () => {
    const entry = appendFeedbackAutomationAudit({
      repositoryPath: "/repo/a",
      action: "guard_block",
      outcome: "skipped",
      reason: "单轮上限",
      patch: makePatch({ id: "p-1", path: "X.md" }),
    });
    const text = formatFeedbackAutomationAuditEntry(entry);
    expect(text).toContain("护栏拦截");
    expect(text).toContain("跳过");
    expect(text).toContain("X.md");
    expect(text).toContain("单轮上限");
  });

  test("formatFeedbackAutomationAuditSummary handles empty", () => {
    expect(formatFeedbackAutomationAuditSummary([])).toBe("暂无自动化审计记录");
  });

  test("formatFeedbackAutomationAuditSummary respects limit", () => {
    for (let i = 0; i < 5; i += 1) {
      appendFeedbackAutomationAudit({
        repositoryPath: "/repo/a",
        action: "auto_apply",
        reason: `r${i}`,
        patch: makePatch({ id: `p-${i}`, path: `f${i}.md` }),
      });
    }
    const summary = formatFeedbackAutomationAuditSummary(listFeedbackAutomationAudit("/repo/a"), 3);
    expect(summary.split("\n").length).toBe(3);
  });
});
