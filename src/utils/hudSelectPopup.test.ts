import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { isInsideHudContextPicker } from "./hudSelectPopup";

beforeAll(() => {
  const domWindow = new Window();
  globalThis.document = domWindow.document as unknown as Document;
});

describe("isInsideHudContextPicker", () => {
  test("treats popover descendants as inside", () => {
    const root = document.createElement("div");
    root.className = "app-hud-context-popover";
    const tab = document.createElement("button");
    root.appendChild(tab);
    document.body.appendChild(root);
    expect(isInsideHudContextPicker(tab)).toBe(true);
    expect(isInsideHudContextPicker(document.body)).toBe(false);
    root.remove();
  });

  test("treats the panel itself as inside", () => {
    const panel = document.createElement("div");
    panel.className = "app-hud-context-panel";
    document.body.appendChild(panel);
    expect(isInsideHudContextPicker(panel)).toBe(true);
    panel.remove();
  });
});
