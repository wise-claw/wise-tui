import { describe, expect, test } from "bun:test";
import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import {
  AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER,
  MAX_AUTO_APPLY_PATCHES_PER_CYCLE,
  assessRegression,
  canAutoApplyPatch,
  collectRecentlyRolledBackKeys,
  createInitialAutomationGuardState,
  feedbackPatchDedupeKey,
  identifyHighPerformingPatchKinds,
  identifyUnderperformingPatchKinds,
  isAutomationCircuitBreakerTripped,
  markPatchAutoApplied,
  markPatchAutoRolledBack,
  resetAutomationCircuitBreaker,
  resetAutomationGuardForCycle,
} from "./feedbackAutomationGuard";

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

describe("feedbackAutomationGuard / canAutoApplyPatch", () => {
  test("fresh guard allows a low-risk patch", () => {
    const guard = createInitialAutomationGuardState();
    expect(canAutoApplyPatch(makePatch(), guard).allowed).toBe(true);
  });

  test("blocks once single-cycle cap reached", () => {
    const guard = createInitialAutomationGuardState();
    guard.appliedThisCycle = MAX_AUTO_APPLY_PATCHES_PER_CYCLE;
    const decision = canAutoApplyPatch(makePatch(), guard);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("单轮上限");
  });

  test("blocks same dedupe key already applied this cycle", () => {
    const guard = createInitialAutomationGuardState();
    const patch = makePatch();
    markPatchAutoApplied(guard, patch);
    const decision = canAutoApplyPatch(makePatch(), guard);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("已应用过相同补丁");
  });

  test("blocks recently rolled-back key across cycles", () => {
    const guard = createInitialAutomationGuardState();
    const patch = makePatch({ id: "patch-rb", path: ".claude/rules/x.md" });
    markPatchAutoRolledBack(guard, patch);
    const decision = canAutoApplyPatch(
      makePatch({ id: "patch-rb-2", path: ".claude/rules/x.md" }),
      guard,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("近期已被自动回滚");
  });

  test("circuit breaker trips after configured consecutive rollbacks", () => {
    const guard = createInitialAutomationGuardState();
    expect(isAutomationCircuitBreakerTripped(guard)).toBe(false);
    for (let i = 0; i < AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER; i += 1) {
      markPatchAutoRolledBack(guard, makePatch({ id: `rb-${i}`, path: `p${i}.md` }));
    }
    expect(isAutomationCircuitBreakerTripped(guard)).toBe(true);
    const decision = canAutoApplyPatch(makePatch({ id: "fresh", path: "fresh.md" }), guard);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("熔断");
  });

  test("resetAutomationCircuitBreaker clears consecutive rollbacks", () => {
    const guard = createInitialAutomationGuardState();
    for (let i = 0; i < AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER; i += 1) {
      markPatchAutoRolledBack(guard, makePatch({ id: `rb-${i}`, path: `p${i}.md` }));
    }
    resetAutomationCircuitBreaker(guard);
    expect(isAutomationCircuitBreakerTripped(guard)).toBe(false);
    // recently rolled-back keys 仍保留（跨轮去重），但熔断已解除
    expect(guard.recentlyRolledBackKeys.size).toBeGreaterThan(0);
  });

  test("resetAutomationGuardForCycle keeps cross-cycle state, clears per-cycle", () => {
    const guard = createInitialAutomationGuardState();
    markPatchAutoApplied(guard, makePatch({ id: "a", path: "a.md" }));
    markPatchAutoRolledBack(guard, makePatch({ id: "b", path: "b.md" }));
    const next = resetAutomationGuardForCycle(guard);
    expect(next.appliedThisCycle).toBe(0);
    expect(next.appliedKeysThisCycle.size).toBe(0);
    expect(next.consecutiveRollbacks).toBe(1);
    expect(next.recentlyRolledBackKeys.size).toBe(1);
  });
});

describe("feedbackAutomationGuard / dedupe key & collectors", () => {
  test("dedupe key includes section", () => {
    const a = feedbackPatchDedupeKey(makePatch({ section: "A" }));
    const b = feedbackPatchDedupeKey(makePatch({ section: "B" }));
    expect(a).not.toBe(b);
  });

  test("collectRecentlyRolledBackKeys only collects auto_rollback patchKeys within window", () => {
    const entries = [
      { action: "auto_rollback", patchKey: "k1" },
      { action: "auto_apply", patchKey: "k2" },
      { action: "auto_rollback", patchKey: "k3" },
      { action: "guard_block", patchKey: "k4" },
    ];
    const keys = collectRecentlyRolledBackKeys(entries, 10);
    expect(keys.has("k1")).toBe(true);
    expect(keys.has("k3")).toBe(true);
    expect(keys.has("k2")).toBe(false);
    expect(keys.has("k4")).toBe(false);
  });

  test("collectRecentlyRolledBackKeys respects window size", () => {
    const entries = [
      { action: "auto_rollback", patchKey: "k1" },
      { action: "auto_rollback", patchKey: "k2" },
    ];
    // window=1 只扫描第一条
    const keys = collectRecentlyRolledBackKeys(entries, 1);
    expect(keys.has("k1")).toBe(true);
    expect(keys.has("k2")).toBe(false);
  });
});

describe("feedbackAutomationGuard / identifyUnderperformingPatchKinds", () => {
  test("returns empty when no hints", () => {
    expect(identifyUnderperformingPatchKinds(null).size).toBe(0);
    expect(identifyUnderperformingPatchKinds([]).size).toBe(0);
  });

  test("ignores kinds below min sample count", () => {
    const out = identifyUnderperformingPatchKinds([
      { kind: "claude_md", count: 1, avgSessionScore: 10, avgRulesDelta: 0, score: 0 },
    ]);
    expect(out.size).toBe(0);
  });

  test("flags kind with sufficient samples and low average score", () => {
    const out = identifyUnderperformingPatchKinds([
      { kind: "claude_md", count: 3, avgSessionScore: 20, avgRulesDelta: 100, score: 0 },
      { kind: "rule", count: 5, avgSessionScore: 80, avgRulesDelta: -10, score: 0 },
    ]);
    expect(out.has("claude_md")).toBe(true);
    expect(out.has("rule")).toBe(false);
  });
});

describe("feedbackAutomationGuard / identifyHighPerformingPatchKinds", () => {
  test("returns empty when no hints", () => {
    expect(identifyHighPerformingPatchKinds(null).size).toBe(0);
    expect(identifyHighPerformingPatchKinds([]).size).toBe(0);
  });

  test("ignores kinds below min sample count", () => {
    const out = identifyHighPerformingPatchKinds([
      { kind: "claude_md", count: 1, avgSessionScore: 90, avgRulesDelta: 0, score: 0 },
    ]);
    expect(out.size).toBe(0);
  });

  test("flags kind with sufficient samples and high average score", () => {
    const out = identifyHighPerformingPatchKinds([
      { kind: "claude_md", count: 3, avgSessionScore: 80, avgRulesDelta: -10, score: 0 },
      { kind: "rule", count: 5, avgSessionScore: 55, avgRulesDelta: 0, score: 0 },
    ]);
    expect(out.has("claude_md")).toBe(true);
    expect(out.has("rule")).toBe(false);
  });

  test("thresholds are disjoint with underperforming kinds", () => {
    const hints = [
      { kind: "claude_md", count: 3, avgSessionScore: 20, avgRulesDelta: 100, score: 0 },
      { kind: "rule", count: 3, avgSessionScore: 80, avgRulesDelta: -10, score: 0 },
      { kind: "memory", count: 3, avgSessionScore: 55, avgRulesDelta: 0, score: 0 },
    ];
    const under = identifyUnderperformingPatchKinds(hints);
    const high = identifyHighPerformingPatchKinds(hints);
    expect(under.has("claude_md")).toBe(true);
    expect(high.has("rule")).toBe(true);
    expect(high.has("claude_md")).toBe(false);
    expect(under.has("rule")).toBe(false);
    // memory 处于中性区间（50 ≤ 55 < 65），既非高表现也非表现不佳
    expect(high.has("memory")).toBe(false);
    expect(under.has("memory")).toBe(false);
  });
});

describe("feedbackAutomationGuard / assessRegression", () => {
  test("no rollback when finalScore is null", () => {
    const r = assessRegression({ finalScore: null, baseline: { average: 70, delta: 0 } });
    expect(r.shouldRollback).toBe(false);
    expect(r.delta).toBe(0);
  });

  test("no rollback when baseline average is null", () => {
    const r = assessRegression({ finalScore: 60, baseline: { average: null, delta: null } });
    expect(r.shouldRollback).toBe(false);
    expect(r.delta).toBeNull();
  });

  test("no rollback when delta above threshold", () => {
    const r = assessRegression({ finalScore: 66, baseline: { average: 70, delta: -4 } });
    expect(r.shouldRollback).toBe(false);
  });

  test("rollback when delta at or below negative threshold", () => {
    const r = assessRegression({ finalScore: 60, baseline: { average: 70, delta: -10 } });
    expect(r.shouldRollback).toBe(true);
    expect(r.delta).toBe(-10);
    expect(r.reason).toContain("10.0");
    expect(r.reason).toContain("阈值");
  });

  test("custom threshold overrides default", () => {
    const r = assessRegression({
      finalScore: 67,
      baseline: { average: 70, delta: -3 },
      threshold: 2,
    });
    expect(r.shouldRollback).toBe(true);
  });
});

describe("feedbackAutomationGuard / collectRecentlyRolledBackKeys cooldown", () => {
  test("filters out rollback keys older than maxAgeMs", () => {
    const now = Date.now();
    const entries = [
      { action: "auto_rollback", patchKey: "recent", at: now - 1000 },
      { action: "auto_rollback", patchKey: "stale", at: now - 10 * 60 * 60 * 1000 },
    ];
    const keys = collectRecentlyRolledBackKeys(entries, 10, 60 * 60 * 1000);
    expect(keys.has("recent")).toBe(true);
    expect(keys.has("stale")).toBe(false);
  });

  test("keeps entries without at field when maxAgeMs given (backward compat)", () => {
    const entries = [{ action: "auto_rollback", patchKey: "no-at" }];
    const keys = collectRecentlyRolledBackKeys(entries, 10, 60 * 60 * 1000);
    expect(keys.has("no-at")).toBe(true);
  });

  test("no maxAgeMs keeps all rollback keys within window", () => {
    const now = Date.now();
    const entries = [
      { action: "auto_rollback", patchKey: "recent", at: now - 1000 },
      { action: "auto_rollback", patchKey: "stale", at: now - 10 * 60 * 60 * 1000 },
    ];
    const keys = collectRecentlyRolledBackKeys(entries, 10);
    expect(keys.has("recent")).toBe(true);
    expect(keys.has("stale")).toBe(true);
  });
});
