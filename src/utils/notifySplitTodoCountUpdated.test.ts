import { afterEach, describe, expect, test } from "bun:test";
import { WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED } from "../constants/workflowUiEvents";

describe("notifySplitTodoCountUpdated", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  test("dispatches window CustomEvent with detail", async () => {
    const received: Array<{ type: string; detail?: { source?: string } }> = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        dispatchEvent: (event: CustomEvent) => {
          received.push({ type: event.type, detail: event.detail });
          return true;
        },
      },
    });

    const { notifySplitTodoCountUpdated } = await import("./notifySplitTodoCountUpdated");
    notifySplitTodoCountUpdated({ source: "trellis", openTaskDrawer: true });

    expect(received).toEqual([
      {
        type: WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED,
        detail: { source: "trellis", openTaskDrawer: true },
      },
    ]);
  });
});
