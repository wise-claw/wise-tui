import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Mock @tauri-apps/api/core BEFORE importing the service so the service
// captures the mocked invoke at module load time.
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
  getExtensionPermissions,
  getExtensionSettingsDeclarations,
  getExtensionSkills,
  getExtensionThemes,
  listExtensions,
  reloadExtensions,
  setExtensionEnabled,
} from "./extensions";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("extensions service", () => {
  test("listExtensions calls extensions_list with no args", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const out = await listExtensions();
    expect(out).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("extensions_list");
  });

  test("getExtensionSkills calls extensions_get_skills", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await getExtensionSkills();
    expect(invokeMock).toHaveBeenCalledWith("extensions_get_skills");
  });

  test("getExtensionThemes calls extensions_get_themes", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await getExtensionThemes();
    expect(invokeMock).toHaveBeenCalledWith("extensions_get_themes");
  });

  test("getExtensionSettingsDeclarations calls the right command", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await getExtensionSettingsDeclarations();
    expect(invokeMock).toHaveBeenCalledWith("extensions_get_settings_declarations");
  });

  test("setExtensionEnabled forwards args under 'args' wrapper", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await setExtensionEnabled("hello-world", false);
    expect(invokeMock).toHaveBeenCalledWith("extensions_set_enabled", {
      args: { name: "hello-world", enabled: false },
    });
  });

  test("getExtensionPermissions forwards name under 'args'", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await getExtensionPermissions("hello-world");
    expect(invokeMock).toHaveBeenCalledWith("extensions_get_permissions", {
      args: { name: "hello-world" },
    });
  });

  test("reloadExtensions calls extensions_reload", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await reloadExtensions();
    expect(invokeMock).toHaveBeenCalledWith("extensions_reload");
  });
});
