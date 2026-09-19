import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  isHudChromeControl,
  isInsideHudContextPicker,
  isInsideHudQuickActionsPicker,
  shouldCloseHudDetailsForChromeTarget,
  shouldScheduleHudOverlayOpen,
} from "./hudSelectPopup";

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

  test("treats the trigger anchor as inside", () => {
    const anchor = document.createElement("div");
    anchor.className = "app-hud-context-anchor";
    const pill = document.createElement("button");
    pill.className = "app-hud-context-pill";
    anchor.appendChild(pill);
    document.body.appendChild(anchor);
    expect(isInsideHudContextPicker(pill)).toBe(true);
    expect(isInsideHudContextPicker(document.body)).toBe(false);
    anchor.remove();
  });
});

describe("isInsideHudQuickActionsPicker", () => {
  test("treats the trigger anchor as inside", () => {
    const anchor = document.createElement("div");
    anchor.className = "app-hud-quick-actions-anchor";
    const trigger = document.createElement("button");
    trigger.className = "app-hud-quick-actions-btn";
    anchor.appendChild(trigger);
    document.body.appendChild(anchor);
    expect(isInsideHudQuickActionsPicker(trigger)).toBe(true);
    expect(isInsideHudQuickActionsPicker(document.body)).toBe(false);
    anchor.remove();
  });

  test("treats the panel itself as inside", () => {
    const panel = document.createElement("div");
    panel.className = "app-hud-quick-actions-panel";
    document.body.appendChild(panel);
    expect(isInsideHudQuickActionsPicker(panel)).toBe(true);
    panel.remove();
  });
});

describe("shouldScheduleHudOverlayOpen", () => {
  test("schedules only the first open request", () => {
    expect(shouldScheduleHudOverlayOpen(false, false)).toBe(true);
    expect(shouldScheduleHudOverlayOpen(true, false)).toBe(false);
    expect(shouldScheduleHudOverlayOpen(false, true)).toBe(false);
    expect(shouldScheduleHudOverlayOpen(true, true)).toBe(false);
  });
});

describe("shouldCloseHudDetailsForChromeTarget", () => {
  test("closes details for picker and quick-action buttons", () => {
    const button = document.createElement("button");
    button.className = "app-hud-quick-actions-btn";
    document.body.appendChild(button);
    expect(shouldCloseHudDetailsForChromeTarget(button)).toBe(true);
    button.remove();

    const pill = document.createElement("button");
    pill.className = "app-hud-context-pill";
    document.body.appendChild(pill);
    expect(shouldCloseHudDetailsForChromeTarget(pill)).toBe(true);
    pill.remove();
  });

  test("keeps details open when clicking the status chip", () => {
    const chip = document.createElement("button");
    chip.className = "app-hud-run-chip";
    const count = document.createElement("span");
    chip.appendChild(count);
    document.body.appendChild(chip);
    expect(shouldCloseHudDetailsForChromeTarget(chip)).toBe(false);
    expect(shouldCloseHudDetailsForChromeTarget(count)).toBe(false);
    chip.remove();
  });

  test("ignores clicks outside HUD chrome", () => {
    expect(shouldCloseHudDetailsForChromeTarget(document.body)).toBe(false);
  });
});

describe("isHudChromeControl", () => {
  test("treats capsule buttons as chrome", () => {
    const button = document.createElement("button");
    button.className = "app-hud-quick-actions-btn";
    document.body.appendChild(button);
    expect(isHudChromeControl(button)).toBe(true);
    expect(isHudChromeControl(document.body)).toBe(false);
    button.remove();
  });

  test("treats the context trigger as chrome", () => {
    const anchor = document.createElement("div");
    anchor.className = "app-hud-context-anchor";
    const pill = document.createElement("button");
    pill.className = "app-hud-context-pill";
    anchor.appendChild(pill);
    document.body.appendChild(anchor);
    expect(isHudChromeControl(pill)).toBe(true);
    anchor.remove();
  });

  test("treats Git stats as chrome", () => {
    const actions = document.createElement("div");
    actions.className = "app-hud-git-actions";
    const stats = document.createElement("span");
    stats.className = "app-hud-git-stats";
    actions.append(stats);
    document.body.appendChild(actions);
    expect(isHudChromeControl(stats)).toBe(true);
    actions.remove();
  });
});
