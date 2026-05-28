import { describe, expect, it } from "bun:test";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";

describe("tabsStore path normalization contract", () => {
  it("matches normalizeSessionRepositoryPath used when loading tabs", () => {
    expect(normalizeSessionRepositoryPath("/work/repo/")).toBe("/work/repo");
    expect(normalizeSessionRepositoryPath("C:\\work\\repo\\")).toBe("C:/work/repo");
  });
});
