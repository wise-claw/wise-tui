import { describe, expect, test } from "bun:test";
import { buildConnectionKindMenuItems } from "./ClaudeConnectionKindChip";
import { buildSessionExecutionEngineMenuItems } from "./SessionExecutionEngineChip";

describe("composer runtime settings menu items", () => {
  test("builds engine and connection menu groups without throwing", () => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine: "claude",
      codexAvailable: true,
      cursorAvailable: true,
      geminiAvailable: true,
      opencodeAvailable: true,
    });
    const connectionItems = buildConnectionKindMenuItems("streaming", "streaming");

    expect(engineItems).toHaveLength(5);
    expect(connectionItems).toHaveLength(2);
    expect(engineItems?.[0]?.key).toBe("claude");
    expect(connectionItems?.[1]?.key).toBe("streaming");
  });

  test("only shows detected or installed engines", () => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine: "claude",
      codexAvailable: true,
      cursorAvailable: false,
      geminiAvailable: false,
      opencodeAvailable: false,
    });
    expect(engineItems).toHaveLength(2);
    expect(engineItems?.map((item) => item?.key)).toEqual(["claude", "codex"]);
  });

  test("hides all optional engines when none are available", () => {
    const engineItems = buildSessionExecutionEngineMenuItems({
      engine: "claude",
      codexAvailable: false,
      cursorAvailable: false,
      geminiAvailable: false,
      opencodeAvailable: false,
    });
    expect(engineItems).toHaveLength(1);
    expect(engineItems?.[0]?.key).toBe("claude");
  });
});
