import { describe, expect, test } from "bun:test";
import { plainBodyHasExplicitSlashCommand } from "./composerDefaultInstruction";
import {
  pickDefaultInstructionByPriority,
  resolveComposerSendDefaultInstructionApplied,
  resolveComposerSendDefaultInstructionPrefix,
  resolveDefaultInstructionBody,
  resolveEffectiveDefaultInstructionConfig,
} from "./resolveEffectiveDefaultInstruction";

describe("resolveEffectiveDefaultInstruction", () => {
  test("pickDefaultInstructionByPriority prefers terminal over global", () => {
    expect(pickDefaultInstructionByPriority("/global", "/terminal")).toBe("/terminal");
    expect(pickDefaultInstructionByPriority("/global", "")).toBe("/global");
    expect(pickDefaultInstructionByPriority("", "/terminal")).toBe("/terminal");
  });

  test("resolveDefaultInstructionBody strips leading @mentions", () => {
    expect(resolveDefaultInstructionBody("@终端1 你好")).toBe("你好");
    expect(resolveDefaultInstructionBody("你好")).toBe("你好");
  });

  test("plainBodyHasExplicitSlashCommand detects leading slash commands", () => {
    expect(plainBodyHasExplicitSlashCommand("/compact")).toBe(true);
    expect(plainBodyHasExplicitSlashCommand("你好")).toBe(false);
    expect(plainBodyHasExplicitSlashCommand("")).toBe(false);
  });

  test("resolveEffectiveDefaultInstructionConfig skips when user typed slash command", () => {
    expect(
      resolveEffectiveDefaultInstructionConfig("/compact", {
        globalDefault: "/autopilot",
      }),
    ).toBe("");
    expect(
      resolveEffectiveDefaultInstructionConfig("@终端1 /compact", {
        globalDefault: "/autopilot",
        terminalDefault: "/ultrawork",
        dispatchTargetType: "employee",
      }),
    ).toBe("");
  });

  test("resolveEffectiveDefaultInstructionConfig uses terminal default for @终端", () => {
    expect(
      resolveEffectiveDefaultInstructionConfig("@终端1 你好", {
        globalDefault: "/global",
        terminalDefault: "/terminal",
        dispatchTargetType: "employee",
      }),
    ).toBe("/terminal");
    expect(
      resolveEffectiveDefaultInstructionConfig("@终端1 你好", {
        globalDefault: "/global",
        terminalDefault: "",
        dispatchTargetType: "employee",
      }),
    ).toBe("/global");
  });

  test("resolveComposerSendDefaultInstructionPrefix skips composer prefix for @终端", () => {
    expect(
      resolveComposerSendDefaultInstructionPrefix("你好", "/autopilot", "employee", "/term"),
    ).toBe("");
    expect(resolveComposerSendDefaultInstructionPrefix("你好", "/autopilot", "main")).toBe(
      "/autopilot",
    );
    expect(
      resolveComposerSendDefaultInstructionPrefix("/compact", "/autopilot", "main"),
    ).toBe("");
  });

  test("resolveComposerSendDefaultInstructionApplied respects dispatch target", () => {
    expect(resolveComposerSendDefaultInstructionApplied("你好", "/autopilot", "employee")).toBe("");
    expect(resolveComposerSendDefaultInstructionApplied("你好", "/autopilot", "main")).toBe(
      "/autopilot",
    );
  });
});
