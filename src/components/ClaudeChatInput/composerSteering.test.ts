import { expect, test } from "bun:test";
import { shouldSteerComposer } from "./composerSteering";

const tab = { key: "Tab", shiftKey: false, ctrlKey: false, metaKey: false,
  altKey: false, isComposing: false, repeat: false };

test("Tab steers either Codex environment only while running", () => {
  for (const engine of ["codex", "codex-rpc"] as const) {
    expect(shouldSteerComposer(tab, engine, true, false)).toBe(true);
    expect(shouldSteerComposer(tab, engine, false, false)).toBe(false);
  }
  expect(shouldSteerComposer(tab, "claude", true, false)).toBe(false);
  expect(shouldSteerComposer({ ...tab, key: "Enter" }, "codex", true, false)).toBe(false);
});

test("completion, IME, repeated and modified Tab cannot send accidentally", () => {
  expect(shouldSteerComposer(tab, "codex", true, true)).toBe(false);
  for (const key of ["shiftKey", "ctrlKey", "metaKey", "altKey", "isComposing", "repeat"]) {
    expect(shouldSteerComposer({ ...tab, [key]: true }, "codex", true, false)).toBe(false);
  }
});

test("Claude only handles Tab when a streaming steering target is available", () => {
  expect(shouldSteerComposer(tab, "claude", true, false, true)).toBe(true);
  expect(shouldSteerComposer(tab, "claude", false, false, true)).toBe(false);
  expect(shouldSteerComposer(tab, "claude", true, true, true)).toBe(false);
  expect(shouldSteerComposer(tab, "cursor", true, false, true)).toBe(false);
});
