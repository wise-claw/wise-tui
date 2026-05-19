import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async () => null),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  buildAssistantEngineeringJson,
  buildAssistantRuntimeBundleJson,
  DEFAULT_PRD_SPLIT_ASSISTANT_ID,
  parseAssistantEngineeringPreferences,
  parseAssistantRuntimeBundle,
  pickAssistantPromptSlotPartial,
  resetAssistantRuntimeOverrides,
  resolveAssistantRuntime,
  saveAssistantRuntimeOverrides,
  type AssistantResolvedRuntime,
} from "./assistantPromptLayers";
import { PROMPT_SLOT_PRD_TASK_SPLIT } from "./splitPromptBundle";

describe("assistantPromptLayers", () => {
  test("resolveAssistantRuntime defaults to builtin:prd-split assistant id", async () => {
    const runtime: AssistantResolvedRuntime = {
      assistantId: "builtin:prd-split",
      source: "builtin",
      systemPrompt: "你好",
      tools: ["update_prd"],
      model: null,
      engineId: "claude",
      promptBundleJson: '{"schemaVersion":2,"prompts":{}}',
      skillBundleJson: "{}",
      mcpBundleJson: "{}",
      engineeringJson: "{}",
    };
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => Promise.resolve(runtime),
    );

    const result = await resolveAssistantRuntime({});

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "assistants_resolve_runtime",
      {
        args: {
          assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
          projectId: null,
          repositoryId: null,
        },
      },
    ]);
    expect(result.systemPrompt).toBe("你好");
  });

  test("resolveAssistantRuntime stringifies numeric repositoryId", async () => {
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () =>
        Promise.resolve({
          assistantId: "builtin:prd-split",
          source: "builtin",
          systemPrompt: "",
          tools: [],
          model: null,
          engineId: "claude",
          promptBundleJson: "{}",
          skillBundleJson: "{}",
          mcpBundleJson: "{}",
          engineeringJson: "{}",
        }),
    );

    await resolveAssistantRuntime({ projectId: "p1", repositoryId: 42 });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "assistants_resolve_runtime",
      {
        args: {
          assistantId: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
          projectId: "p1",
          repositoryId: "42",
        },
      },
    ]);
  });

  test("saveAssistantRuntimeOverrides wraps patch under args", async () => {
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => Promise.resolve(undefined),
    );

    await saveAssistantRuntimeOverrides({
      assistantId: "builtin:prd-split",
      scope: "assistant",
      patch: { skillBundleJson: "{\"disabled\":[]}" },
    });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "assistants_save_overrides",
      {
        args: {
          assistantId: "builtin:prd-split",
          scope: "assistant",
          patch: { skillBundleJson: "{\"disabled\":[]}" },
        },
      },
    ]);
  });

  test("resetAssistantRuntimeOverrides resets selected sections", async () => {
    (invoke as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => Promise.resolve(undefined),
    );

    await resetAssistantRuntimeOverrides({
      assistantId: "builtin:word-doc",
      scope: "assistant",
      sections: ["skills", "engineering"],
    });

    expect((invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)).toEqual([
      "assistants_reset_overrides",
      {
        args: {
          assistantId: "builtin:word-doc",
          scope: "assistant",
          sections: ["skills", "engineering"],
        },
      },
    ]);
  });

  test("pickAssistantPromptSlotPartial returns slot from v2 bundle", () => {
    const runtime: AssistantResolvedRuntime = {
      assistantId: "builtin:prd-split",
      source: "builtin",
      systemPrompt: "",
      tools: [],
      model: null,
      engineId: "claude",
      promptBundleJson: JSON.stringify({
        schemaVersion: 2,
        prompts: {
          [PROMPT_SLOT_PRD_TASK_SPLIT]: {
            templateId: "custom",
            version: "1.0.0",
            enabled: true,
            systemBody: "override system",
            repoStrategyBody: "",
            userBody: "",
          },
        },
      }),
      skillBundleJson: "{}",
      mcpBundleJson: "{}",
      engineeringJson: "{}",
    };

    const partial = pickAssistantPromptSlotPartial(runtime);

    expect(partial?.systemBody).toBe("override system");
    expect(partial?.templateId).toBe("custom");
  });

  test("pickAssistantPromptSlotPartial returns null when slot missing", () => {
    const runtime: AssistantResolvedRuntime = {
      assistantId: "builtin:prd-split",
      source: "builtin",
      systemPrompt: "",
      tools: [],
      model: null,
      engineId: "claude",
      promptBundleJson: '{"schemaVersion":2,"prompts":{}}',
      skillBundleJson: "{}",
      mcpBundleJson: "{}",
      engineeringJson: "{}",
    };

    expect(pickAssistantPromptSlotPartial(runtime)).toBeNull();
  });

  test("assistant runtime bundle helpers preserve disabled and custom entries", () => {
    const parsed = parseAssistantRuntimeBundle(JSON.stringify({
      disabled: ["builtin:trellis-brainstorm"],
      custom: [
        {
          id: "skill:prd-review",
          label: "PRD Review",
          origin: "custom",
          sourcePath: "/tmp/prd-review",
        },
      ],
    }));

    expect(parsed.disabled).toEqual(["builtin:trellis-brainstorm"]);
    expect(parsed.custom[0]?.label).toBe("PRD Review");
    expect(JSON.parse(buildAssistantRuntimeBundleJson(parsed))).toEqual({
      disabled: ["builtin:trellis-brainstorm"],
      custom: [
        {
          id: "skill:prd-review",
          label: "PRD Review",
          origin: "custom",
          sourcePath: "/tmp/prd-review",
        },
      ],
    });
  });

  test("engineering preference helpers validate and normalize json", () => {
    const parsed = parseAssistantEngineeringPreferences(JSON.stringify({
      reuseExistingParents: true,
      dispatchOnlyDirty: false,
      formatProfile: "  公司报告模板  ",
      ignored: "x",
    }));

    expect(parsed).toEqual({
      reuseExistingParents: true,
      dispatchOnlyDirty: false,
      formatProfile: "  公司报告模板  ",
    });
    expect(JSON.parse(buildAssistantEngineeringJson(parsed))).toEqual({
      reuseExistingParents: true,
      dispatchOnlyDirty: false,
      formatProfile: "公司报告模板",
    });
    expect(parseAssistantEngineeringPreferences("not-json")).toEqual({});
  });
});
