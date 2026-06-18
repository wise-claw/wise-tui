import { describe, expect, test } from "bun:test";
import {
  isTransientGitNetworkError,
  retryTransientGitNetworkError,
} from "./retryTransientGitNetworkError";

describe("isTransientGitNetworkError", () => {
  test("recognises curl/RPC/flush failures as transient", () => {
    expect(
      isTransientGitNetworkError(
        new Error(
          "Pull failed: error: RPC failed; curl 28 Failed to connect to github.com port 443 after 75001 ms: Couldn't connect to server\nfatal: expected flush after ref listing",
        ),
      ),
    ).toBe(true);
    expect(isTransientGitNetworkError(new Error("Could not resolve host: github.com"))).toBe(true);
    expect(isTransientGitNetworkError(new Error("the remote end hung up unexpectedly"))).toBe(true);
    expect(isTransientGitNetworkError(new Error("early EOF"))).toBe(true);
  });

  test("non-network errors are NOT retried", () => {
    expect(
      isTransientGitNetworkError(new Error("error: failed to push some refs (non-fast-forward)")),
    ).toBe(false);
    expect(
      isTransientGitNetworkError(new Error("Authentication failed for 'https://github.com/...'")),
    ).toBe(false);
    expect(isTransientGitNetworkError(new Error("nothing to commit, working tree clean"))).toBe(
      false,
    );
  });
});

describe("retryTransientGitNetworkError", () => {
  test("returns immediately on success", async () => {
    let calls = 0;
    const value = await retryTransientGitNetworkError(async () => {
      calls += 1;
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries transient errors then succeeds", async () => {
    let calls = 0;
    const sleepCalls: number[] = [];
    const value = await retryTransientGitNetworkError(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("RPC failed; curl 28 Failed to connect to github.com port 443");
        }
        return "ok";
      },
      {
        attempts: 4,
        initialBackoffMs: 5,
        backoffFactor: 2,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    expect(sleepCalls).toEqual([5, 10]);
  });

  test("does NOT retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      retryTransientGitNetworkError(
        async () => {
          calls += 1;
          throw new Error("Authentication failed");
        },
        { attempts: 5, initialBackoffMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow("Authentication failed");
    expect(calls).toBe(1);
  });

  test("rethrows the last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      retryTransientGitNetworkError(
        async () => {
          calls += 1;
          throw new Error(`expected flush after ref listing (attempt ${calls})`);
        },
        { attempts: 3, initialBackoffMs: 0, sleep: async () => {} },
      ),
    ).rejects.toThrow(/attempt 3/);
    expect(calls).toBe(3);
  });

  test("invokes onRetry with attempt + delay metadata", async () => {
    const events: Array<{ attempt: number; nextDelayMs: number }> = [];
    let calls = 0;
    await retryTransientGitNetworkError(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("Couldn't connect to server");
        }
        return "ok";
      },
      {
        attempts: 3,
        initialBackoffMs: 7,
        sleep: async () => {},
        onRetry: ({ attempt, nextDelayMs }) => {
          events.push({ attempt, nextDelayMs });
        },
      },
    );
    expect(events).toEqual([{ attempt: 1, nextDelayMs: 7 }]);
  });
});
