import { describe, expect, test } from "bun:test";
import { releasePointerCaptureSafe } from "./releasePointerCapture";

describe("releasePointerCaptureSafe", () => {
  test("null 节点不抛错", () => {
    expect(() => releasePointerCaptureSafe(null, 1)).not.toThrow();
  });

  test("有 capture 时调用 releasePointerCapture", () => {
    const released: number[] = [];
    releasePointerCaptureSafe(
      {
        hasPointerCapture: (id) => id === 7,
        releasePointerCapture: (id) => {
          released.push(id);
        },
      },
      7,
    );
    expect(released).toEqual([7]);
  });

  test("无 capture 时不调用 release", () => {
    let called = false;
    releasePointerCaptureSafe(
      {
        hasPointerCapture: () => false,
        releasePointerCapture: () => {
          called = true;
        },
      },
      1,
    );
    expect(called).toBe(false);
  });

  test("release 抛错时吞掉", () => {
    expect(() =>
      releasePointerCaptureSafe(
        {
          hasPointerCapture: () => true,
          releasePointerCapture: () => {
            throw new Error("detached");
          },
        },
        1,
      ),
    ).not.toThrow();
  });
});
