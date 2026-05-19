import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  transformCallback: () => 0,
  Channel: class {},
  PluginListener: class {},
  addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (s: string) => s,
}));

import {
  deleteCustomAssistant,
  getAssistantSystemPrompt,
  listAssistants,
  saveCustomAssistant,
} from "./assistants";
import type { CustomAssistantInput } from "../types/assistant";

beforeEach(() => {
  invokeMock.mockReset();
});

const sample: CustomAssistantInput = {
  name: "code-reviewer",
  engineId: "claude",
  description: "Reviews diffs",
  systemPrompt: "You are a code reviewer.",
};

describe("assistants service", () => {
  test("listAssistants calls assistants_list", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listAssistants();
    expect(invokeMock).toHaveBeenCalledWith("assistants_list");
  });

  test("saveCustomAssistant wraps under args.input", async () => {
    invokeMock.mockResolvedValueOnce({});
    await saveCustomAssistant(sample);
    expect(invokeMock).toHaveBeenCalledWith("assistants_save_custom", {
      args: { input: sample },
    });
  });

  test("deleteCustomAssistant wraps customId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await deleteCustomAssistant("abc");
    expect(invokeMock).toHaveBeenCalledWith("assistants_delete_custom", {
      args: { customId: "abc" },
    });
  });

  test("getAssistantSystemPrompt wraps id", async () => {
    invokeMock.mockResolvedValueOnce("prompt body");
    await getAssistantSystemPrompt("custom:xyz");
    expect(invokeMock).toHaveBeenCalledWith("assistants_get_system_prompt", {
      args: { id: "custom:xyz" },
    });
  });
});
