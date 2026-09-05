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
    document.body.appendChild(shell);
    expect(hudPointShouldClickThrough(shell)).toBe(true);
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
    const selectDropdown = document.createElement("div");
    selectDropdown.className = "ant-select-dropdown";
    document.body.appendChild(selectDropdown);
    expect(hudPointShouldClickThrough(btn)).toBe(false);
    expect(hudPointShouldClickThrough(popover)).toBe(false);
    expect(hudPointShouldClickThrough(selectDropdown)).toBe(false);
    bar.remove();
    popover.remove();
    selectDropdown.remove();
  });
});
