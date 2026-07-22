import { describe, expect, test } from "bun:test";
import { terminalLayoutReady } from "./terminalTheme";

describe("terminalTheme layout helpers", () => {
  test("terminalLayoutReady requires positive size", () => {
    const el = {
      clientWidth: 0,
      clientHeight: 0,
    } as HTMLElement;
    expect(terminalLayoutReady(el)).toBe(false);
    const ready = {
      clientWidth: 120,
      clientHeight: 80,
    } as HTMLElement;
    expect(terminalLayoutReady(ready)).toBe(true);
  });
});
