import { describe, expect, test } from "bun:test";
import { repositorySddStackBadgeMeta } from "./repositorySddStackBadge";

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
