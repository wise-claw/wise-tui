import { describe, expect, test } from "bun:test";
import type { PrdDocument } from "../types";
import {
  normalizeClaudeSplitOutputToSplitResult,
  validateClaudeSplitPayloadStrict,
} from "./claudeSplitOutputNormalize";

const PRD: PrdDocument = {
  title: "Test PRD",
  sourceType: "manual" as PrdDocument["sourceType"],
  sourceRef: null,
  background: [],
  goals: [],
  scenarios: [],
  functional: ["需求 1：登录", "需求 2：注销"],
  nonFunctional: [],
  acceptance: [],
};

function baseValidTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    title: "Login",
    description: "Implement login flow",
    role: "frontend",
    executionStatus: "executable",
    subtasks: ["s1"],
    dod: ["d1"],
    sourceRequirementIds: ["req-functional-1"],
    taskAnchors: {
      from: 0,
      to: 8,
      textHash: "abc",
      contextBefore: "",
      contextAfter: "需求 1：登录",
    },
    ...overrides,
  };
}

describe("validateClaudeSplitPayloadStrict · classification", () => {
  test("missing classification accepted (defaults to lightweight)", () => {
    const out = validateClaudeSplitPayloadStrict({
      payload: { tasks: [baseValidTask()] },
      source: PRD,
    });
    expect(out.ok).toBe(true);
  });

  test("classification=complex without designMarkdown → rejected", () => {
    const out = validateClaudeSplitPayloadStrict({
      payload: {
        tasks: [
          baseValidTask({
            classification: "complex",
            implementMarkdown: "## Steps\n1. do",
          }),
        ],
      },
      source: PRD,
    });
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.path.endsWith(".designMarkdown"))).toBe(true);
  });

  test("classification=complex without implementMarkdown → rejected", () => {
    const out = validateClaudeSplitPayloadStrict({
      payload: {
        tasks: [
          baseValidTask({
            classification: "complex",
            designMarkdown: "## Architecture\n...",
          }),
        ],
      },
      source: PRD,
    });
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.path.endsWith(".implementMarkdown"))).toBe(true);
  });

  test("classification=complex with both markdowns → accepted", () => {
    const out = validateClaudeSplitPayloadStrict({
      payload: {
        tasks: [
          baseValidTask({
            classification: "complex",
            designMarkdown: "## Architecture\nfoo",
            implementMarkdown: "## Steps\n1. bar",
          }),
        ],
      },
      source: PRD,
    });
    expect(out.ok).toBe(true);
  });

  test("invalid classification value → rejected", () => {
    const out = validateClaudeSplitPayloadStrict({
      payload: { tasks: [baseValidTask({ classification: "huge" })] },
      source: PRD,
    });
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.path.endsWith(".classification"))).toBe(true);
  });
});

describe("normalizeClaudeSplitOutputToSplitResult · classification", () => {
  test("defaults to lightweight when absent", () => {
    const result = normalizeClaudeSplitOutputToSplitResult({
      payload: { tasks: [baseValidTask()] },
      source: PRD,
      context: null,
    });
    expect(result.splitTasks[0].classification).toBe("lightweight");
    expect(result.splitTasks[0].designMarkdown).toBeUndefined();
    expect(result.splitTasks[0].implementMarkdown).toBeUndefined();
  });

  test("passes through complex markdowns", () => {
    const result = normalizeClaudeSplitOutputToSplitResult({
      payload: {
        tasks: [
          baseValidTask({
            classification: "complex",
            designMarkdown: "## Architecture\nfoo",
            implementMarkdown: "## Steps\n1. bar",
          }),
        ],
      },
      source: PRD,
      context: null,
    });
    expect(result.splitTasks[0].classification).toBe("complex");
    expect(result.splitTasks[0].designMarkdown).toBe("## Architecture\nfoo");
    expect(result.splitTasks[0].implementMarkdown).toBe("## Steps\n1. bar");
  });

  test("snake_case aliases supported", () => {
    const result = normalizeClaudeSplitOutputToSplitResult({
      payload: {
        tasks: [
          baseValidTask({
            classification: "complex",
            design_markdown: "## Architecture\nfoo",
            implement_markdown: "## Steps\n1. bar",
          }),
        ],
      },
      source: PRD,
      context: null,
    });
    expect(result.splitTasks[0].designMarkdown).toBe("## Architecture\nfoo");
    expect(result.splitTasks[0].implementMarkdown).toBe("## Steps\n1. bar");
  });
});
