import { describe, expect, test } from "bun:test";
import {
  parseAcceptanceVerdictPayload,
  resolveAcceptanceVerdictWithGate,
  validateWorkflowAcceptanceVerdictPayload,
} from "./acceptanceVerdict";

const ctx = { taskId: "task-1", graphNodeId: "node-approval-1" };

describe("validateWorkflowAcceptanceVerdictPayload", () => {
  test("accepts minimal valid payload", () => {
    const r = validateWorkflowAcceptanceVerdictPayload({
      schemaVersion: 1,
      workflowAcceptanceVerdict: "approve",
      taskId: "task-1",
      nodeId: "node-approval-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.workflowAcceptanceVerdict).toBe("approve");
    }
  });

  test("rejects wrong enum", () => {
    const r = validateWorkflowAcceptanceVerdictPayload({
      schemaVersion: 1,
      workflowAcceptanceVerdict: "maybe",
      taskId: "task-1",
      nodeId: "node-approval-1",
    });
    expect(r.ok).toBe(false);
  });

  test("rejects schemaVersion 0", () => {
    const r = validateWorkflowAcceptanceVerdictPayload({
      schemaVersion: 0,
      workflowAcceptanceVerdict: "approve",
      taskId: "task-1",
      nodeId: "node-approval-1",
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseAcceptanceVerdictPayload", () => {
  test("delegates to validator", () => {
    const v = parseAcceptanceVerdictPayload({
      schemaVersion: 2,
      workflowAcceptanceVerdict: "reject",
      taskId: "t",
      nodeId: "n",
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.schemaVersion).toBe(2);
  });
});

describe("resolveAcceptanceVerdictWithGate", () => {
  test("schema gate: last ```json fence with verdict", () => {
    const text = `分析\n\`\`\`json\n{"workflowAcceptanceVerdict":"reject","rationale":"不符合"}\n\`\`\``;
    const r = resolveAcceptanceVerdictWithGate(text, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gate).toBe("schema");
      expect(r.decision).toBe("reject");
      expect(r.payload.taskId).toBe(ctx.taskId);
      expect(r.payload.nodeId).toBe(ctx.graphNodeId);
    }
  });

  test("schema gate rejects mismatched taskId in JSON", () => {
    const text = `\`\`\`json\n{"workflowAcceptanceVerdict":"approve","taskId":"other"}\n\`\`\``;
    const r = resolveAcceptanceVerdictWithGate(text, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gate).toBe("inferred");
    }
  });

  test("inferred gate: explicit Chinese conclusion without JSON", () => {
    const text = "综上，验收结论：通过";
    const r = resolveAcceptanceVerdictWithGate(text, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gate).toBe("inferred");
      expect(r.decision).toBe("pass");
    }
  });

  test("returns ok false when nothing matches", () => {
    const r = resolveAcceptanceVerdictWithGate("无结论无 JSON。", ctx);
    expect(r.ok).toBe(false);
  });
});
