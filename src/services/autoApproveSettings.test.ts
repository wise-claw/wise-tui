import { describe, it, expect, beforeEach, mock } from "bun:test";

// 在 import 被测模块前 mock appSettingsStore，使其全部走内存表。
const store = new Map<string, string>();

mock.module("./appSettingsStore", () => ({
  getAppSetting: async (key: string) => (store.has(key) ? store.get(key)! : null),
  setAppSetting: async (key: string, value: string) => {
    store.set(key, value);
  },
  deleteAppSetting: async (key: string) => {
    store.delete(key);
  },
  getAppSettingsBatch: async (keys: string[]) => {
    const out: Record<string, string | null> = {};
    for (const k of keys) out[k] = store.has(k) ? store.get(k)! : null;
    return out;
  },
  getAppSettingJson: async () => null,
  setAppSettingJson: async () => undefined,
}));

const {
  getGlobalAutoApproveMode,
  setGlobalAutoApproveMode,
  getRepoAutoApproveOverride,
  setRepoAutoApproveOverride,
  resolveEffectiveAutoApproveMode,
  __TEST__,
} = await import("./autoApproveSettings");

const PATH_A = "/Users/test/repo-a";
const PATH_B = "/Users/test/repo-b";

beforeEach(() => {
  store.clear();
});

// ─── global ─────────────────────────────────────────────────────

describe("getGlobalAutoApproveMode", () => {
  it("returns 'off' when key is missing", async () => {
    expect(await getGlobalAutoApproveMode()).toBe("off");
  });

  it("returns 'off' when value is non-canonical garbage", async () => {
    store.set(__TEST__.GLOBAL_KEY, "yes");
    expect(await getGlobalAutoApproveMode()).toBe("off");
    store.set(__TEST__.GLOBAL_KEY, "");
    expect(await getGlobalAutoApproveMode()).toBe("off");
  });

  it("returns valid stored modes", async () => {
    store.set(__TEST__.GLOBAL_KEY, "edits");
    expect(await getGlobalAutoApproveMode()).toBe("edits");
    store.set(__TEST__.GLOBAL_KEY, "all");
    expect(await getGlobalAutoApproveMode()).toBe("all");
    store.set(__TEST__.GLOBAL_KEY, "off");
    expect(await getGlobalAutoApproveMode()).toBe("off");
  });
});

describe("setGlobalAutoApproveMode", () => {
  it("writes the value verbatim", async () => {
    await setGlobalAutoApproveMode("edits");
    expect(store.get(__TEST__.GLOBAL_KEY)).toBe("edits");
    await setGlobalAutoApproveMode("all");
    expect(store.get(__TEST__.GLOBAL_KEY)).toBe("all");
    await setGlobalAutoApproveMode("off");
    expect(store.get(__TEST__.GLOBAL_KEY)).toBe("off");
  });

  it("normalizes invalid input down to 'off'", async () => {
    // @ts-expect-error — 测试 runtime 下传非法值会被 normalize
    await setGlobalAutoApproveMode("garbage");
    expect(store.get(__TEST__.GLOBAL_KEY)).toBe("off");
  });
});

// ─── repo override ──────────────────────────────────────────────

describe("getRepoAutoApproveOverride", () => {
  it("returns 'inherit' when key is missing", async () => {
    expect(await getRepoAutoApproveOverride(PATH_A)).toBe("inherit");
  });

  it("returns 'inherit' for empty / invalid value", async () => {
    store.set(__TEST__.repoKey(PATH_A), "");
    expect(await getRepoAutoApproveOverride(PATH_A)).toBe("inherit");
    store.set(__TEST__.repoKey(PATH_B), "bogus");
    expect(await getRepoAutoApproveOverride(PATH_B)).toBe("inherit");
  });

  it("returns the explicit mode when set", async () => {
    store.set(__TEST__.repoKey(PATH_A), "edits");
    expect(await getRepoAutoApproveOverride(PATH_A)).toBe("edits");
    store.set(__TEST__.repoKey(PATH_B), "all");
    expect(await getRepoAutoApproveOverride(PATH_B)).toBe("all");
    store.set(__TEST__.repoKey("/x"), "off");
    expect(await getRepoAutoApproveOverride("/x")).toBe("off");
  });

  it("returns 'inherit' for null / undefined / empty repoPath", async () => {
    expect(await getRepoAutoApproveOverride(null)).toBe("inherit");
    expect(await getRepoAutoApproveOverride(undefined)).toBe("inherit");
    expect(await getRepoAutoApproveOverride("")).toBe("inherit");
    expect(await getRepoAutoApproveOverride("   ")).toBe("inherit");
  });
});

describe("setRepoAutoApproveOverride", () => {
  it("writes explicit modes", async () => {
    await setRepoAutoApproveOverride(PATH_A, "edits");
    expect(store.get(__TEST__.repoKey(PATH_A))).toBe("edits");
  });

  it("'inherit' deletes the key", async () => {
    store.set(__TEST__.repoKey(PATH_A), "all");
    await setRepoAutoApproveOverride(PATH_A, "inherit");
    expect(store.has(__TEST__.repoKey(PATH_A))).toBe(false);
  });

  it("ignores invalid repoPath without throwing", async () => {
    await setRepoAutoApproveOverride(null, "all");
    await setRepoAutoApproveOverride(undefined, "edits");
    await setRepoAutoApproveOverride("", "all");
    await setRepoAutoApproveOverride("   ", "all");
    expect(store.size).toBe(0);
  });
});

// ─── resolveEffectiveAutoApproveMode ────────────────────────────

describe("resolveEffectiveAutoApproveMode", () => {
  it("falls back to 'off' when nothing is set", async () => {
    expect(await resolveEffectiveAutoApproveMode(PATH_A)).toBe("off");
    expect(await resolveEffectiveAutoApproveMode(null)).toBe("off");
    expect(await resolveEffectiveAutoApproveMode(undefined)).toBe("off");
  });

  it("uses global default when no repo override exists", async () => {
    store.set(__TEST__.GLOBAL_KEY, "edits");
    expect(await resolveEffectiveAutoApproveMode(PATH_A)).toBe("edits");
    expect(await resolveEffectiveAutoApproveMode(null)).toBe("edits");
  });

  it("repo override beats global", async () => {
    store.set(__TEST__.GLOBAL_KEY, "off");
    store.set(__TEST__.repoKey(PATH_A), "all");
    expect(await resolveEffectiveAutoApproveMode(PATH_A)).toBe("all");
  });

  it("repo override of 'off' silences a global 'all'", async () => {
    store.set(__TEST__.GLOBAL_KEY, "all");
    store.set(__TEST__.repoKey(PATH_A), "off");
    expect(await resolveEffectiveAutoApproveMode(PATH_A)).toBe("off");
  });

  it("invalid repo override falls through to global", async () => {
    store.set(__TEST__.GLOBAL_KEY, "edits");
    store.set(__TEST__.repoKey(PATH_A), "garbage");
    expect(await resolveEffectiveAutoApproveMode(PATH_A)).toBe("edits");
  });

  it("empty repoPath falls through to global", async () => {
    store.set(__TEST__.GLOBAL_KEY, "edits");
    store.set(__TEST__.repoKey(PATH_A), "all");
    expect(await resolveEffectiveAutoApproveMode("")).toBe("edits");
    expect(await resolveEffectiveAutoApproveMode(null)).toBe("edits");
  });
});
