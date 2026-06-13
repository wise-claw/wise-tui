import { describe, expect, test } from "bun:test";
import {
  repositorySddStackBadgeMeta,
  resolveRepositorySddStackBadgeMeta,
  shouldShowRepositorySddStackBadge,
} from "./repositorySddStackBadge";

describe("repositorySddStackBadgeMeta", () => {
  test("marks wise_trellis for trellis icon", () => {
    expect(repositorySddStackBadgeMeta("wise_trellis")).toMatchObject({
      variant: "wise",
      title: "内置 Wise Trellis 已配置",
    });
  });

  test("marks project_owned for trellis icon", () => {
    expect(repositorySddStackBadgeMeta("project_owned")?.variant).toBe("owned");
  });

  test("hides auto, off, and unset modes", () => {
    expect(repositorySddStackBadgeMeta("auto")).toBeNull();
    expect(repositorySddStackBadgeMeta("off")).toBeNull();
    expect(repositorySddStackBadgeMeta(undefined)).toBeNull();
  });
});

describe("shouldShowRepositorySddStackBadge", () => {
  test("requires trellis bootstrap before showing icon", () => {
    expect(shouldShowRepositorySddStackBadge("wise_trellis", false)).toBe(false);
    expect(shouldShowRepositorySddStackBadge("project_owned", false)).toBe(false);
    expect(shouldShowRepositorySddStackBadge("wise_trellis", true)).toBe(true);
    expect(shouldShowRepositorySddStackBadge("auto", true)).toBe(true);
  });
});

describe("resolveRepositorySddStackBadgeMeta", () => {
  test("falls back to trellis initialized title when sdd mode is auto", () => {
    expect(resolveRepositorySddStackBadgeMeta("auto", true)).toMatchObject({
      title: "Trellis 已初始化",
      variant: "wise",
    });
  });
});
