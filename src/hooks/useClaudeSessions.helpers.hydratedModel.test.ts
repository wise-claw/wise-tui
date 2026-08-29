import { describe, expect, test } from "bun:test";
import { resolveHydratedSessionModel } from "./useClaudeSessions.helpers";

describe("resolveHydratedSessionModel", () => {
  test("keeps the model persisted in tabs.json", () => {
    expect(resolveHydratedSessionModel("anthropic/claude-sonnet-4-5", "sonnet")).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect(resolveHydratedSessionModel("gpt-5.6-luna", "sonnet")).toBe("gpt-5.6-luna");
  });

  test("falls back to the Claude settings model only when the session has none", () => {
    expect(resolveHydratedSessionModel("", "sonnet")).toBe("sonnet");
    expect(resolveHydratedSessionModel("   ", "sonnet")).toBe("sonnet");
    expect(resolveHydratedSessionModel(undefined, "sonnet")).toBe("sonnet");
  });

  test("returns empty when neither side has a model", () => {
    expect(resolveHydratedSessionModel(undefined, undefined)).toBe("");
    expect(resolveHydratedSessionModel(null, "  ")).toBe("");
  });
});
