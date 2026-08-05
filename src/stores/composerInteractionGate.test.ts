import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearComposerInteraction,
  isComposerInteractionActive,
  isComposerTypingActive,
  markComposerFocused,
  markComposerInteraction,
  resetComposerInteractionGateForTests,
  scheduleAfterComposerInteractionIdle,
} from "./composerInteractionGate";

describe("composerInteractionGate", () => {
  beforeEach(() => {
    resetComposerInteractionGateForTests();
  });

  test("isComposerInteractionActive is pure and does not throw after expiry", () => {
    markComposerInteraction();
    expect(isComposerInteractionActive()).toBe(true);
    expect(isComposerTypingActive()).toBe(true);
    clearComposerInteraction();
    expect(isComposerInteractionActive()).toBe(false);
    expect(isComposerTypingActive()).toBe(false);
  });

  test("focused composer stays interaction-active without continuous key events", () => {
    markComposerFocused(true);
    expect(isComposerInteractionActive()).toBe(true);
    expect(isComposerTypingActive()).toBe(false);
    markComposerFocused(false);
    expect(isComposerInteractionActive()).toBe(false);
  });

  test("scheduleAfterComposerInteractionIdle runs immediately when idle", () => {
    let ran = 0;
    scheduleAfterComposerInteractionIdle(() => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });

  test("scheduleAfterComposerInteractionIdle does not hard-defer on focus alone", () => {
    markComposerFocused(true);
    let ran = 0;
    scheduleAfterComposerInteractionIdle(() => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });

  test("scheduleAfterComposerInteractionIdle defers while typing", async () => {
    markComposerInteraction();
    let ran = 0;
    scheduleAfterComposerInteractionIdle(() => {
      ran += 1;
    });
    expect(ran).toBe(0);
    clearComposerInteraction();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ran).toBe(1);
  });
});
