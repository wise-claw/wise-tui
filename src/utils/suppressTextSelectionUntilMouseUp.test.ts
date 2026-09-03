import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { suppressTextSelectionUntilMouseUp } from "./suppressTextSelectionUntilMouseUp";

beforeAll(() => {
  const domWindow = new Window();
  globalThis.window = domWindow as unknown as typeof globalThis.window;
  globalThis.document = domWindow.document as unknown as Document;
  globalThis.Event = domWindow.Event as unknown as typeof Event;
});

describe("suppressTextSelectionUntilMouseUp", () => {
  test("selectstart 被拦住，mouseup 后恢复", () => {
    const restore = suppressTextSelectionUntilMouseUp();
    const selectStart = new Event("selectstart", { cancelable: true });
    document.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(true);

    window.dispatchEvent(new Event("mouseup"));
    const after = new Event("selectstart", { cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    restore();
  });
});
