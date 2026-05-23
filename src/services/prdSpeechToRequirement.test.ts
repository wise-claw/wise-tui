import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { PrdDraftPayload } from "./prdDraftStore";

const loadPrdDraft = mock(async (): Promise<PrdDraftPayload | null> => null);
const savePrdDraft = mock(async () => undefined);

mock.module("./prdDraftStore", () => ({
  loadPrdDraft,
  savePrdDraft,
}));

const { appendConversationTurnToPrdRequirement } = await import("./prdSpeechToRequirement");

const scope = {
  projectScopeId: "proj-1",
  linkedProjectId: "proj-1",
  linkedRepositoryId: 42,
  contextMode: "project" as const,
};

beforeEach(() => {
  loadPrdDraft.mockReset();
  savePrdDraft.mockReset();
  loadPrdDraft.mockResolvedValue(null);
});

describe("appendConversationTurnToPrdRequirement", () => {
  test("creates a new requirement when draft is empty", async () => {
    const result = await appendConversationTurnToPrdRequirement(scope, {
      role: "user",
      text: "你好",
      at: 1_700_000_000_000,
    });
    expect(result?.created).toBe(true);
    expect(savePrdDraft).toHaveBeenCalledTimes(1);
    const [, payload] = savePrdDraft.mock.calls[0] as [string | null, PrdDraftPayload];
    expect(payload.requirements).toHaveLength(1);
    expect(payload.requirements?.[0]?.inputValue).toContain("你好");
    expect(payload.requirements?.[0]?.requirementDisplayName).toContain("谈话需求");
  });

  test("appends to the active requirement", async () => {
    loadPrdDraft.mockResolvedValue({
      inputValue: "已有内容",
      contextMode: "project",
      linkedProjectId: "proj-1",
      linkedRepositoryId: 42,
      requirementDisplayName: "旧需求",
      currentRequirementId: "req-old",
      requirements: [
        {
          id: "req-old",
          requirementDisplayName: "旧需求",
          inputValue: "已有内容",
          contextMode: "project",
          linkedProjectId: "proj-1",
          linkedRepositoryId: 42,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const result = await appendConversationTurnToPrdRequirement(scope, {
      role: "assistant",
      text: "收到",
      at: 2,
    });
    expect(result?.created).toBe(false);
    const [, payload] = savePrdDraft.mock.calls[0] as [string | null, PrdDraftPayload];
    expect(payload.requirements?.[0]?.inputValue).toContain("已有内容");
    expect(payload.requirements?.[0]?.inputValue).toContain("收到");
  });
});
