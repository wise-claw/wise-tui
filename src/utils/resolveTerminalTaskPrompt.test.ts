import { describe, expect, test } from "bun:test";
import type { EmployeeItem } from "../types";
import { resolveTerminalTaskPromptWithDefaults, resolveTerminalDefaultInstructionApplied } from "./resolveTerminalTaskPrompt";

const terminal = (overrides: Partial<EmployeeItem> = {}): EmployeeItem =>
  ({
    id: "e1",
    name: "终端01",
    agentType: "executor",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    displayOrder: 0,
    repositoryIds: [],
    projectIds: [],
    ...overrides,
  }) as EmployeeItem;

describe("resolveTerminalTaskPromptWithDefaults", () => {
  test("keeps non-empty user body when no default configured", () => {
    expect(resolveTerminalTaskPromptWithDefaults("继续实现", terminal(), "")).toBe("继续实现");
  });

  test("prepends session default to user body", () => {
    expect(resolveTerminalTaskPromptWithDefaults("继续实现", terminal(), "/autopilot")).toBe(
      "/autopilot 继续实现",
    );
  });

  test("falls back to terminal default instruction", () => {
    expect(
      resolveTerminalTaskPromptWithDefaults("  ", terminal({ defaultInstruction: "/autopilot" }), ""),
    ).toBe("/autopilot");
  });

  test("prepends terminal default to user body", () => {
    expect(
      resolveTerminalTaskPromptWithDefaults(
        "你好",
        terminal({ defaultInstruction: "/autopilot" }),
        "",
      ),
    ).toBe("/autopilot 你好");
  });

  test("falls back to session default when terminal has none", () => {
    expect(resolveTerminalTaskPromptWithDefaults("你好", terminal(), "/autopilot")).toBe(
      "/autopilot 你好",
    );
  });

  test("terminal default wins over session default", () => {
    expect(
      resolveTerminalTaskPromptWithDefaults(
        "你好",
        terminal({ defaultInstruction: "/terminal-cmd" }),
        "/global-cmd",
      ),
    ).toBe("/terminal-cmd 你好");
  });

  test("skips defaults when user already typed a slash command", () => {
    expect(
      resolveTerminalTaskPromptWithDefaults(
        "/compact",
        terminal({ defaultInstruction: "/autopilot" }),
        "/autopilot",
      ),
    ).toBe("/compact");
  });

  test("resolveTerminalDefaultInstructionApplied returns empty when slash command present", () => {
    expect(
      resolveTerminalDefaultInstructionApplied(
        "/compact",
        terminal({ defaultInstruction: "/autopilot" }),
        "/autopilot",
      ),
    ).toBe("");
  });
});
