import { describe, it, expect } from "bun:test";
import {
  decidePermissionAutoApprove,
  decideQuestionAutoApprove,
  normalizeAutoApproveMode,
  EDIT_AUTO_APPROVE_TOOLS,
  type AutoApproveMode,
} from "./autoApproveDecide";

// ─── normalizeAutoApproveMode ───────────────────────────────────

describe("normalizeAutoApproveMode", () => {
  it("keeps valid modes unchanged", () => {
    expect(normalizeAutoApproveMode("off")).toBe("off");
    expect(normalizeAutoApproveMode("edits")).toBe("edits");
    expect(normalizeAutoApproveMode("all")).toBe("all");
  });

  it("downgrades null / undefined / random strings to off", () => {
    expect(normalizeAutoApproveMode(null)).toBe("off");
    expect(normalizeAutoApproveMode(undefined)).toBe("off");
    expect(normalizeAutoApproveMode("")).toBe("off");
    expect(normalizeAutoApproveMode("ON")).toBe("off");
    expect(normalizeAutoApproveMode("true")).toBe("off");
    expect(normalizeAutoApproveMode(0)).toBe("off");
    expect(normalizeAutoApproveMode(1)).toBe("off");
    expect(normalizeAutoApproveMode({})).toBe("off");
  });
});

// ─── EDIT_AUTO_APPROVE_TOOLS ────────────────────────────────────

describe("EDIT_AUTO_APPROVE_TOOLS", () => {
  it("contains the expected edit tools", () => {
    expect(EDIT_AUTO_APPROVE_TOOLS.has("Edit")).toBe(true);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("Write")).toBe(true);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("MultiEdit")).toBe(true);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("NotebookEdit")).toBe(true);
    expect(EDIT_AUTO_APPROVE_TOOLS.size).toBe(4);
  });

  it("does not include non-edit tools or non-Anthropic tool names", () => {
    expect(EDIT_AUTO_APPROVE_TOOLS.has("Bash")).toBe(false);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("Read")).toBe(false);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("ExitPlanMode")).toBe(false);
    expect(EDIT_AUTO_APPROVE_TOOLS.has("AskUserQuestion")).toBe(false);
    // Update was removed in code-review hardening — third-party MCPs that name a tool
    // "Update" must not piggyback on the auto-approve allowlist.
    expect(EDIT_AUTO_APPROVE_TOOLS.has("Update")).toBe(false);
  });
});

// ─── decidePermissionAutoApprove ────────────────────────────────

describe("decidePermissionAutoApprove", () => {
  const editTools = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
  const nonEditTools = ["Bash", "Read", "ExitPlanMode", "UnknownTool", "mcp_xyz", "Update"];

  describe("mode = off", () => {
    it.each([...editTools, ...nonEditTools])("returns null for tool=%s", (tool) => {
      expect(decidePermissionAutoApprove("off", { tool, controlSubtype: "can_use_tool" })).toBeNull();
      expect(decidePermissionAutoApprove("off", { tool, controlSubtype: "permission" })).toBeNull();
    });
  });

  describe("mode = all", () => {
    it.each([...editTools, ...nonEditTools])("returns allow_once for every tool=%s", (tool) => {
      expect(decidePermissionAutoApprove("all", { tool, controlSubtype: "permission" })).toBe("allow_once");
      expect(decidePermissionAutoApprove("all", { tool, controlSubtype: "can_use_tool" })).toBe("allow_once");
    });
  });

  describe("mode = edits", () => {
    it.each(editTools)("returns allow_once for edit tool=%s", (tool) => {
      expect(decidePermissionAutoApprove("edits", { tool, controlSubtype: "permission" })).toBe("allow_once");
    });

    it.each(nonEditTools)("returns null for non-edit tool=%s", (tool) => {
      expect(decidePermissionAutoApprove("edits", { tool, controlSubtype: "can_use_tool" })).toBeNull();
    });
  });

  it("returns null when tool is empty or missing", () => {
    expect(decidePermissionAutoApprove("edits", { tool: "", controlSubtype: "permission" })).toBeNull();
    expect(
      decidePermissionAutoApprove("edits", { tool: "", controlSubtype: "can_use_tool" }),
    ).toBeNull();
  });

  it("controlSubtype does not influence 'edits' decision", () => {
    // Both subtypes with an edit tool → allow_once
    expect(
      decidePermissionAutoApprove("edits", { tool: "Edit", controlSubtype: "permission" }),
    ).toBe("allow_once");
    expect(
      decidePermissionAutoApprove("edits", { tool: "Edit", controlSubtype: "can_use_tool" }),
    ).toBe("allow_once");
    // Both subtypes with a non-edit tool → null
    expect(
      decidePermissionAutoApprove("edits", { tool: "Bash", controlSubtype: "permission" }),
    ).toBeNull();
    expect(
      decidePermissionAutoApprove("edits", { tool: "Bash", controlSubtype: "can_use_tool" }),
    ).toBeNull();
  });
});

// ─── decideQuestionAutoApprove ──────────────────────────────────

describe("decideQuestionAutoApprove", () => {
  const simpleOptions = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];

  describe("mode = off or edits", () => {
    it.each<AutoApproveMode>(["off", "edits"])("returns null for mode=%s", (mode) => {
      expect(
        decideQuestionAutoApprove(mode, { options: simpleOptions, multiSelect: false }),
      ).toBeNull();
    });
  });

  describe("mode = all", () => {
    it("returns first option for single-select", () => {
      const result = decideQuestionAutoApprove("all", {
        options: simpleOptions,
        multiSelect: false,
      });
      expect(result).toEqual({ answers: ["yes"], customAnswer: "" });
    });

    it("returns all options for multi-select", () => {
      const result = decideQuestionAutoApprove("all", {
        options: simpleOptions,
        multiSelect: true,
      });
      expect(result).toEqual({ answers: ["yes", "no"], customAnswer: "" });
    });

    it("returns null when options is null/undefined/empty", () => {
      expect(
        decideQuestionAutoApprove("all", { options: [], multiSelect: false }),
      ).toBeNull();
      expect(
        decideQuestionAutoApprove("all", { options: [], multiSelect: true }),
      ).toBeNull();
    });

    it("skips options with missing / empty value", () => {
      const result = decideQuestionAutoApprove("all", {
        options: [
          { value: "", label: "Empty value" },
          { value: "valid", label: "Valid" },
        ],
        multiSelect: false,
      });
      expect(result).toEqual({ answers: ["valid"], customAnswer: "" });
    });

    it("falls back to dock when multiSelect has any option with empty value", () => {
      // 部分有效的 multiSelect 不应自动答题：避免把不对称答案塞给 Claude。
      const result = decideQuestionAutoApprove("all", {
        options: [
          { value: "", label: "Empty value" },
          { value: "valid", label: "Valid" },
        ],
        multiSelect: true,
      });
      expect(result).toBeNull();
    });

    it("multiSelect with all valid options returns full answer set", () => {
      const result = decideQuestionAutoApprove("all", {
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        multiSelect: true,
      });
      expect(result).toEqual({ answers: ["a", "b"], customAnswer: "" });
    });

    it("returns null if all options have empty values after filtering", () => {
      expect(
        decideQuestionAutoApprove("all", {
          options: [{ value: "", label: "Empty" }],
          multiSelect: false,
        }),
      ).toBeNull();
    });

    it("handles undefined multiSelect as single-select (first option)", () => {
      const result = decideQuestionAutoApprove("all", {
        options: simpleOptions,
        // no multiSelect property
      });
      expect(result).toEqual({ answers: ["yes"], customAnswer: "" });
    });
  });
});