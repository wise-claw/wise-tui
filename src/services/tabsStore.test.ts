import { describe, expect, it } from "bun:test";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";
import { normalizePersistedSession } from "./tabsStore";

describe("tabsStore path normalization contract", () => {
  it("matches normalizeSessionRepositoryPath used when loading tabs", () => {
    expect(normalizeSessionRepositoryPath("/work/repo/")).toBe("/work/repo");
    expect(normalizeSessionRepositoryPath("C:\\work\\repo\\")).toBe("C:/work/repo");
  });
});

describe("normalizePersistedSession ultracodeEnabled coercion", () => {
  it("保留合法 boolean", () => {
    const out = normalizePersistedSession({
      id: "s1",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      ultracodeEnabled: true,
    });
    expect(out.ultracodeEnabled).toBe(true);
    const out2 = normalizePersistedSession({
      id: "s2",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      ultracodeEnabled: false,
    });
    expect(out2.ultracodeEnabled).toBe(false);
  });

  it("非 boolean 字段被静默剥除（tabs.json 脏数据兜底）", () => {
    for (const dirty of ["true", 1, null, { enabled: true }, [true]]) {
      const out = normalizePersistedSession({
        id: "s3",
        repositoryPath: "/work/repo",
        repositoryName: "repo",
        ultracodeEnabled: dirty,
      });
      expect(out.ultracodeEnabled).toBeUndefined();
    }
  });

  it("undefined / 未设置时不存在字段", () => {
    const out = normalizePersistedSession({
      id: "s4",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
    });
    expect("ultracodeEnabled" in out).toBe(false);
  });
});
