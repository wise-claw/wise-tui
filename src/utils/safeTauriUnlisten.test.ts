import { expect, mock, test } from "bun:test";
import { collectTauriListeners } from "./safeTauriUnlisten";

test("a failed listener batch cleans both completed and late subscriptions", async () => {
  const early = mock(() => {});
  const late = mock(() => {});
  let resolveLate!: (fn: () => void) => void;
  const pending = collectTauriListeners([
    Promise.resolve(early),
    Promise.reject(new Error("registration failed")),
    new Promise<() => void>((resolve) => { resolveLate = resolve; }),
  ]);
  await expect(pending).rejects.toThrow("registration failed");
  expect(early).toHaveBeenCalledTimes(1);
  resolveLate(late);
  await Promise.resolve();
  expect(late).toHaveBeenCalledTimes(1);
});

test("successful batches stay subscribed until the caller releases them", async () => {
  const first = mock(() => {});
  const second = mock(() => {});
  const listeners = await collectTauriListeners([Promise.resolve(first), Promise.resolve(second)]);
  expect(listeners).toEqual([first, second]);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
});
