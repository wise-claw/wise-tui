import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeSession } from "../../types";

// 档案编辑弹层不参与底栏显示测试；保留真实 Dropdown 与模型选择器。
mock.module("../ClaudeSessions/ClaudeModelTopbarPanel", () => ({
  ClaudeModelTopbarPanel: () => null,
}));

import { ComposerModelPicker } from "./ComposerModelPicker";
import { seedModelProfileStoreCache } from "../../stores/modelProfileStoreCache";
import {
  resetExecutionEngineModelListsForTests,
  saveCachedCodexModels,
} from "../../services/executionEngineModelListCache";

afterEach(() => {
  seedModelProfileStoreCache(null);
  resetExecutionEngineModelListsForTests();
});

describe("Codex RPC model picker trigger", () => {
  test("a fresh picker shows selected Terra even when the active provider profile is default", async () => {
    seedModelProfileStoreCache({
      profiles: [{
        id: "openai", engine: "codex", company: "openAI", name: "default",
        modelId: "gpt-5.6-terra", settingsJson: "{}", createdAtMs: 0, updatedAtMs: 0,
      }],
      activeProfileId: null,
      activeCodexProfileId: "openai",
      activeOpencodeProfileId: null,
      effectiveModel: null,
      effectiveCodexModel: "gpt-5.6-terra",
      effectiveOpencodeModel: null,
    });
    await saveCachedCodexModels([{ id: "gpt-5.6-terra", displayName: "GPT-5.6-Terra" }]);
    const session = {
      id: "new-tab", model: "gpt-5.6-terra", repositoryPath: "/repo", executionEngine: "codex-rpc",
    } as ClaudeSession;
    const html = renderToStaticMarkup(<ComposerModelPicker
      session={session}
      sessionExecutionEngine="codex-rpc"
      model={session.model!}
      onModelChange={() => undefined}
    />);
    expect(html).toContain('aria-label="当前模型：GPT-5.6-Terra"');
    expect(html).toContain('app-composer-model-picker-bar-label__model">GPT-5.6-Terra</span>');
    expect(html).not.toContain('app-composer-model-picker-bar-label__model">default</span>');
  });
});
