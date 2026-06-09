import { describe, expect, test } from "bun:test";
import {
  isClaudeScrollInteractionActive,
  markClaudeScrollInteraction,
} from "./claudeScrollInteractionGate";

describe("claudeScrollInteractionGate", () => {
  test("scroll interaction enables defer window", () => {
    markClaudeScrollInteraction();
    expect(isClaudeScrollInteractionActive()).toBe(true);
  });
});
