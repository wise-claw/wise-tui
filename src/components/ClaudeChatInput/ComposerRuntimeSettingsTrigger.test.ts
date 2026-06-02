import { describe, expect, test } from "bun:test";
import { buildConnectionKindMenuItems } from "./ClaudeConnectionKindChip";
import { buildSessionExecutionEngineMenuItems } from "./SessionExecutionEngineChip";

describe("composer runtime settings menu items", () => {
  test("builds engine and connection menu groups without throwing", () => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine: "claude",
      codexAvailable: true,
    });
    const connectionItems = buildConnectionKindMenuItems("streaming", "streaming");

    expect(engineItems).toHaveLength(3);
    expect(connectionItems).toHaveLength(2);
    expect(engineItems?.[0]?.key).toBe("claude");
    expect(connectionItems?.[1]?.key).toBe("streaming");
  });

  test("hides Cursor SDK from engine menu when not available", () => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine: "claude",
      codexAvailable: true,
      cursorAvailable: false,
    });
    expect(engineItems).toHaveLength(2);
    expect(engineItems?.map((item) => item?.key)).toEqual(["claude", "codex"]);
  });
});
