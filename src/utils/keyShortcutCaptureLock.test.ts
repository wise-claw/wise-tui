import { describe, expect, test } from "bun:test";
import {
  beginKeyShortcutCapture,
  endKeyShortcutCapture,
  isKeyShortcutCaptureListening,
  resetKeyShortcutCaptureLockForTests,
  subscribeKeyShortcutCaptureLock,
} from "./keyShortcutCaptureLock";

describe("keyShortcutCaptureLock", () => {
  test("tracks nested capture sessions", () => {
    resetKeyShortcutCaptureLockForTests();
    expect(isKeyShortcutCaptureListening()).toBe(false);

    beginKeyShortcutCapture();
    expect(isKeyShortcutCaptureListening()).toBe(true);

    beginKeyShortcutCapture();
    endKeyShortcutCapture();
    expect(isKeyShortcutCaptureListening()).toBe(true);

    endKeyShortcutCapture();
    expect(isKeyShortcutCaptureListening()).toBe(false);
  });

  test("notifies subscribers when capture starts and ends", () => {
    resetKeyShortcutCaptureLockForTests();
    const seen: boolean[] = [];
    const unsubscribe = subscribeKeyShortcutCaptureLock(() => {
      seen.push(isKeyShortcutCaptureListening());
    });

    beginKeyShortcutCapture();
    beginKeyShortcutCapture();
    endKeyShortcutCapture();
    endKeyShortcutCapture();
    unsubscribe();

    expect(seen).toEqual([true, false]);
  });
});
