import { describe, expect, test } from "bun:test";
import { promiseWithTimeout } from "./promiseWithTimeout";

describe("promiseWithTimeout", () => {
  test("resolves before timeout", async () => {
    await expect(promiseWithTimeout(Promise.resolve(42), 500, "测试")).resolves.toBe(42);
  });

  test("rejects when timed out", async () => {
    await expect(
      promiseWithTimeout(new Promise<number>(() => {}), 30, "推送"),
    ).rejects.toThrow("推送超时");
  });
});
