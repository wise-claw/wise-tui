import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDirty,
  classifyRawValue,
  deriveStateFromInfo,
  resolveValueToSave,
  SENTINEL_INVALID,
} from "./types";
import type { ClaudeUserConfigDirInfo } from "../../services/claudeConfigDir";

const codefuseRaw = "~/.codefuse/engine/cc";
let serviceInfo: ClaudeUserConfigDirInfo;

mock.module("../../services/claudeConfigDir", () => ({
  CLAUDE_USER_CONFIG_DIR_PRESETS: [
    { key: "default", label: "默认", description: "~/.claude", rawValue: null },
    { key: "codefuse", label: "Codefuse", description: "fork", rawValue: codefuseRaw },
  ],
  getClaudeUserConfigDir: mock(async () => serviceInfo),
  setClaudeUserConfigDir: mock(async (rawValue: string | null) => {
    serviceInfo = info({
      rawValue,
      isDefault: rawValue == null,
      resolvedPath: rawValue ?? "/Users/me/.claude",
      exists: true,
    });
    return serviceInfo;
  }),
}));

mock.module("./useClaudeConfigDir", () => ({
  useClaudeConfigDir: () => ({
    info: serviceInfo,
    loading: false,
    saving: false,
    refresh: mock(async () => undefined),
    save: mock(async () => serviceInfo),
    reset: mock(async () => undefined),
  }),
}));

mock.module("./useClaudeConfigDirChoice", () => ({
  useClaudeConfigDirChoice: (currentInfo: ClaudeUserConfigDirInfo | null) => ({
    state: currentInfo ? deriveStateFromInfo(currentInfo) : { choice: "default", customDraft: "" },
    setChoice: mock(() => undefined),
    setCustomDraft: mock(() => undefined),
    dirty: false,
    resolveValueToSave: mock(() => null),
    syncToInfo: mock(() => undefined),
  }),
}));

const baseInfo: ClaudeUserConfigDirInfo = {
  rawValue: null,
  resolvedPath: "/Users/me/.claude",
  defaultResolvedPath: "/Users/me/.claude",
  isDefault: true,
  exists: true,
};

beforeEach(() => {
  serviceInfo = baseInfo;
});

function info(overrides: Partial<ClaudeUserConfigDirInfo>): ClaudeUserConfigDirInfo {
  return { ...baseInfo, ...overrides };
}

describe("ClaudeConfigDir helpers (composition seam)", () => {
  test("classifyRawValue maps preset rawValue to its key", () => {
    expect(classifyRawValue(null)).toBe("default");
    expect(classifyRawValue("")).toBe("default");
    expect(classifyRawValue("   ")).toBe("default");
    expect(classifyRawValue(codefuseRaw)).toBe("codefuse");
    expect(classifyRawValue("/elsewhere")).toBe("custom");
  });

  test("deriveStateFromInfo seeds customDraft only for custom paths", () => {
    expect(deriveStateFromInfo(info({ rawValue: null }))).toEqual({
      choice: "default",
      customDraft: "",
    });
    expect(deriveStateFromInfo(info({ rawValue: codefuseRaw }))).toEqual({
      choice: "codefuse",
      customDraft: "",
    });
    expect(deriveStateFromInfo(info({ rawValue: "/x/y", isDefault: false }))).toEqual({
      choice: "custom",
      customDraft: "/x/y",
    });
  });

  test("buildDirty flips on choice change and on custom draft edits", () => {
    const i = info({ rawValue: "/x/y", isDefault: false });
    expect(buildDirty({ choice: "custom", customDraft: "/x/y" }, i)).toBe(false);
    expect(buildDirty({ choice: "custom", customDraft: "/x/y/" }, i)).toBe(true);
    expect(buildDirty({ choice: "default", customDraft: "" }, i)).toBe(true);
    expect(buildDirty({ choice: "codefuse", customDraft: "" }, i)).toBe(true);
  });

  test("resolveValueToSave returns null for default, codefuse rawValue, and custom path", () => {
    expect(resolveValueToSave({ choice: "default", customDraft: "" })).toBeNull();
    expect(resolveValueToSave({ choice: "codefuse", customDraft: "" })).toBe(codefuseRaw);
    expect(resolveValueToSave({ choice: "custom", customDraft: "/x/y" })).toBe("/x/y");
    expect(resolveValueToSave({ choice: "custom", customDraft: "  /x/y  " })).toBe("/x/y");
  });

  test("resolveValueToSave returns SENTINEL_INVALID when custom draft is blank", () => {
    expect(resolveValueToSave({ choice: "custom", customDraft: "" })).toBe(SENTINEL_INVALID);
    expect(resolveValueToSave({ choice: "custom", customDraft: "   " })).toBe(SENTINEL_INVALID);
  });

  test("renders the engine environment panel with current path", async () => {
    const { ClaudeConfigDirPanel } = await import(".");
    const html = renderToStaticMarkup(<ClaudeConfigDirPanel />);

    expect(html).toContain("当前引擎环境");
    expect(html).toContain("环境预设");
    expect(html).toContain("影响范围");
    expect(html).not.toContain("Engine Environment");
  });
});
