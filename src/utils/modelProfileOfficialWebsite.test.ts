import { describe, expect, test } from "bun:test";
import {
  normalizeModelProfileOfficialWebsite,
  validateModelProfileOfficialWebsite,
} from "./modelProfileOfficialWebsite";

describe("normalizeModelProfileOfficialWebsite", () => {
  test("returns null for empty input", () => {
    expect(normalizeModelProfileOfficialWebsite("")).toBeNull();
    expect(normalizeModelProfileOfficialWebsite("   ")).toBeNull();
  });

  test("adds https scheme when missing", () => {
    expect(normalizeModelProfileOfficialWebsite("example.com")).toBe("https://example.com/");
  });

  test("keeps explicit https url", () => {
    expect(normalizeModelProfileOfficialWebsite("https://dashscope.aliyun.com")).toBe(
      "https://dashscope.aliyun.com/",
    );
  });
});

describe("validateModelProfileOfficialWebsite", () => {
  test("allows empty optional field", () => {
    expect(validateModelProfileOfficialWebsite("")).toBeNull();
  });

  test("rejects invalid url", () => {
    expect(validateModelProfileOfficialWebsite("not a url")).toBeTruthy();
  });
});
