import { describe, expect, test } from "bun:test";
import {
  isRecentExplicitSidebarSessionSelect,
  markExplicitSidebarSessionSelect,
  resetExplicitSidebarSessionSelectForTests,
} from "./explicitSidebarSessionSelect";

describe("explicitSidebarSessionSelect", () => {
  test("marks and recognizes recent explicit select", () => {
    resetExplicitSidebarSessionSelectForTests();
    markExplicitSidebarSessionSelect("session-a");
    expect(isRecentExplicitSidebarSessionSelect("session-a")).toBe(true);
    expect(isRecentExplicitSidebarSessionSelect("session-b")).toBe(false);
  });

  test("ignores blank ids", () => {
    resetExplicitSidebarSessionSelectForTests();
    markExplicitSidebarSessionSelect("  ");
    expect(isRecentExplicitSidebarSessionSelect("")).toBe(false);
  });
});
