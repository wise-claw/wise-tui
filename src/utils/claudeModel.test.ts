import { describe, expect, test } from "bun:test";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  buildClaudeModelPickerOptions,
  resolveClaudeExecModelId,
  resolveClaudeProfileModelFromStore,
} from "./claudeModel";

const store = (partial: Partial<ClaudeModelProfileStoreView>): ClaudeModelProfileStoreView =>
  ({
    profiles: [],
    activeProfileId: "claude-1",
    activeCodexProfileId: null,
    activeOpencodeProfileId: null,
    effectiveModel: "glm-5",
    effectiveCodexModel: null,
    effectiveOpencodeModel: null,
    ...partial,
  }) as ClaudeModelProfileStoreView;

describe("resolveClaudeProfileModelFromStore", () => {
  test("prefers effectiveModel", () => {
    expect(resolveClaudeProfileModelFromStore(store({}))).toBe("glm-5");
  });

  test("falls back to active claude profile modelId", () => {
    expect(
      resolveClaudeProfileModelFromStore(
        store({
          effectiveModel: null,
          profiles: [
            {
              id: "claude-1",
              company: "Zhipu",
              name: "GLM",
              modelId: "glm-4.7",
              settingsJson: "{}",
              engine: "claude",
              createdAtMs: 0,
              updatedAtMs: 0,
            },
          ],
        }),
      ),
    ).toBe("glm-4.7");
  });
});

describe("resolveClaudeExecModelId", () => {
  test("prefers profile model over stale session.model", () => {
    expect(
      resolveClaudeExecModelId({
        sessionModel: "sonnet",
        store: store({ effectiveModel: "glm-5" }),
      }),
    ).toBe("glm-5");
  });

  test("falls back to session model when profile is empty", () => {
    expect(
      resolveClaudeExecModelId({
        sessionModel: "opus",
        store: store({ effectiveModel: null, profiles: [] }),
      }),
    ).toBe("opus");
  });
});

describe("buildClaudeModelPickerOptions", () => {
  const profile = (
    partial: Partial<import("../types/claudeModelProfile").ClaudeModelProfile>,
  ): import("../types/claudeModelProfile").ClaudeModelProfile => ({
    id: "p-1",
    company: "火山",
    name: "glm-latest",
    modelId: "glm-latest",
    settingsJson: "{}",
    engine: "claude",
    createdAtMs: 0,
    updatedAtMs: 0,
    ...partial,
  });

  test("模型切换中的全部 claude 档案进入快捷列表，档案优先", () => {
    const opts = buildClaudeModelPickerOptions({
      picker: {
        defaultModel: "deepseek-v4-flash",
        availableModels: ["minimax-m3", "glm-5.1", "glm-latest", "auto"],
      },
      profiles: [
        profile({ id: "p-mini", company: "火山", name: "minimax-m3", modelId: "minimax-m3" }),
        profile({ id: "p-glm", company: "火山", name: "glm-latest", modelId: "glm-latest" }),
        profile({ id: "p-unconf", company: "MiniMax", name: "M3", modelId: "MiniMax-M3" }),
      ],
    });
    // 档案全部在列（含未写入 settings.json 的 MiniMax-M3），配置模型按全量 id 补入。
    expect(opts.map((o) => o.value)).toEqual([
      "minimax-m3",
      "glm-latest",
      "MiniMax-M3",
      "deepseek-v4-flash",
      "glm-5.1",
      "auto",
    ]);
    expect(opts.find((o) => o.value === "minimax-m3")).toMatchObject({
      company: "火山",
      profileId: "p-mini",
    });
    expect(opts.find((o) => o.value === "MiniMax-M3")).toMatchObject({
      company: "MiniMax",
      profileId: "p-unconf",
    });
    // 未命中档案的配置模型展示完整模型 id（而不是缩短的展示名）。
    expect(opts.find((o) => o.value === "glm-5.1")).toMatchObject({ label: "glm-5.1" });
    expect(opts.find((o) => o.value === "auto")).toMatchObject({ label: "auto" });
  });

  test("配置模型与档案同模型（忽略大小写）时不重复出现", () => {
    const opts = buildClaudeModelPickerOptions({
      picker: { defaultModel: null, availableModels: ["minimax-m3"] },
      profiles: [
        profile({ id: "p-mini", company: "火山", name: "minimax-m3", modelId: "minimax-m3" }),
      ],
    });
    expect(opts.map((o) => o.value)).toEqual(["minimax-m3"]);
    expect(opts[0]).toMatchObject({ company: "火山", profileId: "p-mini" });
  });

  test("无配置模型时仍并入 claude 档案模型，完全为空则兜底官方模型", () => {
    expect(
      buildClaudeModelPickerOptions({
        picker: { defaultModel: null, availableModels: [] },
        profiles: [profile({ id: "p-glm", company: "智谱", name: "GLM", modelId: "glm-5" })],
      }).map((o) => o.value),
    ).toEqual(["glm-5"]);
    expect(
      buildClaudeModelPickerOptions({
        picker: { defaultModel: null, availableModels: [] },
        profiles: [],
      }).map((o) => o.value),
    ).toEqual(["claude-sonnet-4-8", "claude-opus-4-8", "claude-haiku-4-8"]);
  });

  test("当前会话模型始终可选中（含短名别名）且与列表去重", () => {
    const opts = buildClaudeModelPickerOptions({
      picker: { defaultModel: "deepseek-v4-flash", availableModels: ["glm-5.1"] },
      profiles: [],
      sessionModel: "glm-5.1",
      currentModel: "sonnet",
    });
    expect(opts.map((o) => o.value)).toEqual(["deepseek-v4-flash", "glm-5.1", "sonnet"]);
  });
});
