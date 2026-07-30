import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { isTerminalInputArmed } from "./terminalInputArmed";

beforeAll(() => {
  const domWindow = new Window();
  globalThis.document = domWindow.document as unknown as Document;
});

describe("isTerminalInputArmed", () => {
  test("false when start is null", () => {
    expect(isTerminalInputArmed(null, { hidden: false })).toBe(false);
  });

  test("false when document is hidden", () => {
    const el = document.createElement("div");
    expect(isTerminalInputArmed(el, { hidden: true })).toBe(false);
  });

  test("false when an ancestor has inert", () => {
    const pane = document.createElement("div");
    pane.setAttribute("inert", "");
    const surface = document.createElement("div");
    pane.appendChild(surface);
    expect(isTerminalInputArmed(surface, { hidden: false })).toBe(false);
  });

  test("false when an ancestor has is-hidden", () => {
    const pane = document.createElement("div");
    pane.classList.add("is-hidden");
    const surface = document.createElement("div");
    pane.appendChild(surface);
    expect(isTerminalInputArmed(surface, { hidden: false })).toBe(false);
  });

  test("true when surface is shown and document visible", () => {
    const pane = document.createElement("div");
    const surface = document.createElement("div");
    pane.appendChild(surface);
    expect(isTerminalInputArmed(surface, { hidden: false })).toBe(true);
  });
});
