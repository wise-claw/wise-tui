import { describe, expect, test } from "bun:test";
import {
  applyComposerDefaultInstruction,
  formatComposerDefaultInstructionChip,
  normalizeComposerDefaultInstruction,
  resolveAppliedComposerDefaultInstruction,
  shouldApplyComposerDefaultInstruction,
} from "./composerDefaultInstruction";

describe("composerDefaultInstruction", () => {
  test("normalizeComposerDefaultInstruction ensures leading slash", () => {
    expect(normalizeComposerDefaultInstruction("autopilot")).toBe("/autopilot");
    expect(normalizeComposerDefaultInstruction("/autopilot")).toBe("/autopilot");
  });

  test("formatComposerDefaultInstructionChip wraps with brackets", () => {
    expect(formatComposerDefaultInstructionChip("/autopilot")).toBe("[/autopilot]");
  });

  test("applyComposerDefaultInstruction prepends slash command", () => {
    expect(applyComposerDefaultInstruction("你好", "/autopilot")).toBe("/autopilot 你好");
  });

  test("applyComposerDefaultInstruction skips when already present", () => {
    expect(applyComposerDefaultInstruction("/autopilot 继续", "/autopilot")).toBe("/autopilot 继续");
  });

  test("applyComposerDefaultInstruction inserts after @mention", () => {
    expect(shouldApplyComposerDefaultInstruction("@终端1 你好", "/autopilot")).toBe(true);
    expect(applyComposerDefaultInstruction("@终端1 你好", "/autopilot")).toBe("@终端1 /autopilot 你好");
  });

  test("applyComposerDefaultInstruction inserts after multi-word execution engine @mention", () => {
    expect(shouldApplyComposerDefaultInstruction("@Claude Code 你好", "/autopilot")).toBe(true);
    expect(applyComposerDefaultInstruction("@Claude Code 你好", "/autopilot")).toBe(
      "@Claude Code /autopilot 你好",
    );
  });

  test("applyComposerDefaultInstruction uses plugin namespace when OMC installed", () => {
    const ctx = { omcInstalled: true, pluginCacheSkills: [], projectSkills: [] };
    expect(applyComposerDefaultInstruction("你好", "/ultrawork", ctx)).toBe(
      "/oh-my-claudecode:ultrawork 你好",
    );
    expect(resolveAppliedComposerDefaultInstruction("你好", "/ultrawork", ctx)).toBe(
      "/oh-my-claudecode:ultrawork",
    );
  });

  test("applyComposerDefaultInstruction skips when instruction already after @mention", () => {
    expect(applyComposerDefaultInstruction("@终端1 /autopilot 你好", "/autopilot")).toBe(
      "@终端1 /autopilot 你好",
    );
  });

  test("applyComposerDefaultInstruction inserts after multiple @mentions", () => {
    expect(applyComposerDefaultInstruction("@终端1 @终端2 你好", "/autopilot")).toBe(
      "@终端1 @终端2 /autopilot 你好",
    );
  });

  test("applyComposerDefaultInstruction adds instruction after lone @mention", () => {
    expect(applyComposerDefaultInstruction("@终端1", "/autopilot")).toBe("@终端1 /autopilot");
  });

  test("applyComposerDefaultInstruction skips explicit slash commands", () => {
    expect(shouldApplyComposerDefaultInstruction("/compact", "/autopilot")).toBe(false);
    expect(shouldApplyComposerDefaultInstruction("@终端1 /compact", "/autopilot")).toBe(false);
  });

  test("applyComposerDefaultInstruction skips when instruction appears later in body", () => {
    expect(applyComposerDefaultInstruction("@终端1 你好 /autopilot", "/autopilot")).toBe(
      "@终端1 你好 /autopilot",
    );
  });

  test("empty body returns instruction alone", () => {
    expect(applyComposerDefaultInstruction("", "/autopilot")).toBe("/autopilot");
  });

  test("resolveAppliedComposerDefaultInstruction returns normalized instruction when applicable", () => {
    expect(resolveAppliedComposerDefaultInstruction("你好", "/autopilot")).toBe("/autopilot");
    expect(resolveAppliedComposerDefaultInstruction("/compact", "/autopilot")).toBe("");
  });
});
