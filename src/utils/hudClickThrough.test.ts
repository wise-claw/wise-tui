import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { hudPointShouldClickThrough } from "./hudClickThrough";

beforeAll(() => {
  const domWindow = new Window();
  globalThis.document = domWindow.document as unknown as Document;
});

describe("hudPointShouldClickThrough", () => {
  test("lets empty chrome through", () => {
    const shell = document.createElement("div");
    shell.className = "app-hud-shell";
    const drag = document.createElement("div");
    drag.className = "app-hud-drag-shell";
    shell.appendChild(drag);
    document.body.appendChild(shell);
    expect(hudPointShouldClickThrough(drag)).toBe(true);
    expect(hudPointShouldClickThrough(document.body)).toBe(true);
    expect(hudPointShouldClickThrough(null)).toBe(true);
    shell.remove();
  });

  test("keeps the capsule and popovers hittable", () => {
    const bar = document.createElement("div");
    bar.className = "app-hud-bar";
    const btn = document.createElement("button");
    bar.appendChild(btn);
    document.body.appendChild(bar);
    const popover = document.createElement("div");
    popover.className = "app-hud-quick-actions-popover";
    document.body.appendChild(popover);
    expect(hudPointShouldClickThrough(btn)).toBe(false);
    expect(hudPointShouldClickThrough(popover)).toBe(false);
    bar.remove();
    popover.remove();
  });
});
