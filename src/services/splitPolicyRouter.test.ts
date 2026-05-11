import { describe, expect, test } from "bun:test";
import { decideSplitPolicy } from "./splitPolicyRouter";

describe("decideSplitPolicy", () => {
  test("routes timeline-heavy PRDs to journey-first splitting", () => {
    const decision = decideSplitPolicy({
      prdText: [
        "# Milestone plan",
        "Phase 1 发布核心路径，Phase 2 上线协作面板。",
        "阶段一需要在两周内完成，阶段二按月迭代。",
      ].join("\n"),
      requirements: [
        { id: "r1", text: "第一阶段完成登录到创建任务的用户路径" },
        { id: "r2", text: "第二阶段完成发布后的复盘路径" },
      ],
    });

    expect(decision.policyId).toBe("user_journey_first");
    expect(decision.policyFeatures.timelineKeywordCount).toBeGreaterThan(0);
    expect(decision.rationale.join("\n")).toContain("timelineRatio");
  });

  test("routes technical implementation signals to tech-layer splitting", () => {
    const decision = decideSplitPolicy({
      prdText: "API schema, database indexes, webhook queue, RPC module, auth permissions.",
      requirements: [
        {
          id: "r1",
          text: "Implement API schema validation, database table indexes, cache invalidation, queue concurrency, webhook retries, and grpc adapters.",
        },
      ],
    });

    expect(decision.policyId).toBe("tech_layer_first");
    expect(decision.policyFeatures.technicalKeywordCount).toBeGreaterThan(0);
    expect(decision.rationale.join("\n")).toContain("techRatio");
  });

  test("falls back to feature-domain splitting for balanced feature lists", () => {
    const decision = decideSplitPolicy({
      prdText: "Users need repository management, project grouping, notifications, and settings.",
      requirements: [
        { id: "r1", text: "Repository list supports create edit remove" },
        { id: "r2", text: "Project grouping supports multiple repositories" },
        { id: "r3", text: "Notification center supports unread state" },
        { id: "r4", text: "Settings panel supports preferences" },
        { id: "r5", text: "Task panel supports saved drafts" },
        { id: "r6", text: "Terminal panel supports shell sessions" },
      ],
    });

    expect(decision.policyId).toBe("feature_domain_first");
    expect(decision.policyFeatures.requirementCount).toBe(6);
    expect(decision.policyFeatures.timelineKeywordRatio).toBe(0);
    expect(decision.policyFeatures.technicalKeywordRatio).toBe(0);
  });

  test("handles empty inputs without producing invalid ratios", () => {
    const decision = decideSplitPolicy({ prdText: "", requirements: [] });

    expect(decision.policyId).toBe("feature_domain_first");
    expect(decision.policyFeatures.requirementCount).toBe(0);
    expect(decision.policyFeatures.headingDensity).toBe(0);
    expect(decision.policyFeatures.timelineKeywordRatio).toBe(0);
    expect(decision.policyFeatures.technicalKeywordRatio).toBe(0);
  });
});
