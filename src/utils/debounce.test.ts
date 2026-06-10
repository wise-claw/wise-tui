import { describe, expect, test } from "bun:test";
import { debounce } from "./debounce";

describe("debounce", () => {
  test("flushes the last pending call immediately", async () => {
    let count = 0;
    const fn = debounce(() => {
      count += 1;
    }, 50);
    fn();
    fn();
    expect(count).toBe(0);
    fn.flush();
    expect(count).toBe(1);
  });

  test("cancel drops pending calls", async () => {
    let count = 0;
    const fn = debounce(() => {
      count += 1;
    }, 50);
    fn();
    fn.cancel();
    fn.flush();
    expect(count).toBe(0);
  });
});
