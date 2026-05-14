import { describe, expect, test } from "bun:test";
import {
  computeBodyHash,
  computeIndexVersion,
  fnv1a64Hex,
  normalizeRequirementContent,
  upgradeRequirementsIndex,
} from "./requirementsIndexVersion";

describe("fnv1a64Hex", () => {
  test("deterministic and 16-char hex", () => {
    const h = fnv1a64Hex("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex("hello world")).toBe(h);
  });

  test("differs across distinct inputs", () => {
    expect(fnv1a64Hex("a")).not.toBe(fnv1a64Hex("b"));
  });

  test("UTF-8 stable", () => {
    const h = fnv1a64Hex("登录");
    expect(h).toBe(fnv1a64Hex("登录"));
  });
});

describe("normalizeRequirementContent", () => {
  test("strips outer whitespace and normalizes CRLF", () => {
    expect(normalizeRequirementContent("  foo\r\nbar  ")).toBe("foo\nbar");
  });
});

describe("computeBodyHash", () => {
  test("ignores leading/trailing whitespace", () => {
    expect(computeBodyHash("  hello  ")).toBe(computeBodyHash("hello"));
  });

  test("ignores CRLF vs LF difference", () => {
    expect(computeBodyHash("a\r\nb")).toBe(computeBodyHash("a\nb"));
  });
});

describe("computeIndexVersion", () => {
  test("stable across reordering", () => {
    const a = computeIndexVersion([
      { id: "r2", content: "X", bodyHash: "h2" },
      { id: "r1", content: "Y", bodyHash: "h1" },
    ]);
    const b = computeIndexVersion([
      { id: "r1", content: "Y", bodyHash: "h1" },
      { id: "r2", content: "X", bodyHash: "h2" },
    ]);
    expect(a).toBe(b);
  });

  test("changes when bodyHash changes", () => {
    const a = computeIndexVersion([{ id: "r1", content: "x", bodyHash: "h1" }]);
    const b = computeIndexVersion([{ id: "r1", content: "x", bodyHash: "h2" }]);
    expect(a).not.toBe(b);
  });
});

describe("upgradeRequirementsIndex", () => {
  test("fills bodyHash + version for v1 input", () => {
    const upgraded = upgradeRequirementsIndex({
      requirements: [
        { id: "r1", content: "登录" },
        { id: "r2", content: "注册" },
      ],
    });
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.requirements[0].bodyHash).toMatch(/^[0-9a-f]{16}$/);
    expect(upgraded.version).toMatch(/^[0-9a-f]{16}$/);
  });

  test("recomputes when bodyHash format is malformed", () => {
    const upgraded = upgradeRequirementsIndex({
      requirements: [{ id: "r1", content: "x", bodyHash: "bogus" }],
    });
    expect(upgraded.requirements[0].bodyHash).toMatch(/^[0-9a-f]{16}$/);
    expect(upgraded.requirements[0].bodyHash).not.toBe("bogus");
  });

  test("keeps valid bodyHash unchanged but recomputes version", () => {
    const goodHash = "0123456789abcdef";
    const upgraded = upgradeRequirementsIndex({
      requirements: [{ id: "r1", content: "anything", bodyHash: goodHash }],
    });
    expect(upgraded.requirements[0].bodyHash).toBe(goodHash);
    expect(upgraded.version).toMatch(/^[0-9a-f]{16}$/);
  });
});
