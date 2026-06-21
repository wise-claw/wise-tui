import { describe, expect, test } from "bun:test";
import { arePropsEqualSkipping } from "./reactPropsEqual";

describe("arePropsEqualSkipping", () => {
  test("treats differing function props as equal when skipFunctions is true", () => {
    const prev = { id: 1, onClick: () => undefined };
    const next = { id: 1, onClick: () => undefined };
    expect(arePropsEqualSkipping(prev, next, { skipFunctions: true })).toBe(true);
  });

  test("detects data prop changes when skipFunctions is true", () => {
    const handler = () => undefined;
    const prev = { id: 1, onClick: handler };
    const next = { id: 2, onClick: handler };
    expect(arePropsEqualSkipping(prev, next, { skipFunctions: true })).toBe(false);
  });

  test("skips listed keys", () => {
    const prev = { keep: 1, drop: "a" };
    const next = { keep: 1, drop: "b" };
    expect(arePropsEqualSkipping(prev, next, { skipKeys: ["drop"] })).toBe(true);
  });
});
