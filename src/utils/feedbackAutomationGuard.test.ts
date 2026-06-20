import { describe, expect, test } from "bun:test";
import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import {
  AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER,
  MAX_AUTO_APPLY_PATCHES_PER_CYCLE,
  canAutoApplyPatch,
  collectRecentlyRolledBackKeys,
  createInitialAutomationGuardState,
  feedbackPatchDedupeKey,
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
