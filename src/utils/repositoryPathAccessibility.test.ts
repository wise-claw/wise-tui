import { describe, expect, it } from "bun:test";
import { formatRepositoryExplorerLoadError } from "./repositoryPathAccessibility";

describe("formatRepositoryExplorerLoadError", () => {
  it("passes through localized path-missing errors from backend", () => {
    const msg = "仓库路径在本机不存在：/old/path。若刚换电脑…";
    expect(formatRepositoryExplorerLoadError(msg, "/old/path")).toBe(msg);
  });

  it("appends migration hint for generic errors", () => {
    const out = formatRepositoryExplorerLoadError("permission denied", "/repo");
    expect(out).toContain("permission denied");
    expect(out).toContain("换电脑");
  });
});
