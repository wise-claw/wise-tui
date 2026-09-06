import { expect, test } from "bun:test";
import { createComposerSendScope, requireComposerDispatchAccepted } from "./composerSendScope";

test("session switch during payload preparation rejects the old send and preserves the new lock", async () => {
  const generation = { current: 1 };
  const old = createComposerSendScope(generation);
  let resolve!: (value: string) => void;
  const prepared = old.wait(new Promise<string>((yes) => { resolve = yes; }));
  generation.current += 1;
  const next = createComposerSendScope(generation);
  let locked = true;
  resolve("old payload");
  await expect(prepared).rejects.toThrow("会话已切换");
  old.finish(() => { locked = false; });
  expect(locked).toBe(true);
  expect(await next.wait(Promise.resolve("new payload"))).toBe("new payload");
  next.finish(() => { locked = false; });
  expect(locked).toBe(false);
});

test("preparation failure preserves the original error and still permits lock cleanup", async () => {
  const scope = createComposerSendScope({ current: 1 });
  await expect(scope.wait(Promise.reject(new Error("attachment write failed")))).rejects.toThrow("attachment write failed");
  let finished = false;
  scope.finish(() => { finished = true; });
  expect(finished).toBe(true);
});


test("explicit rejection propagates to draft recovery, while queued and legacy accepted sends succeed", async () => {
  await expect(requireComposerDispatchAccepted(false)).rejects.toThrow("消息未能提交");
  await expect(requireComposerDispatchAccepted(Promise.resolve(false))).rejects.toThrow("消息未能提交");
  await expect(requireComposerDispatchAccepted(true)).resolves.toBeUndefined();
  await expect(requireComposerDispatchAccepted(undefined)).resolves.toBeUndefined();
  await expect(requireComposerDispatchAccepted(Promise.reject(new Error("dispatch failed")))).rejects.toThrow("dispatch failed");
});
