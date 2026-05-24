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

    expect(engineItems).toHaveLength(2);
    expect(connectionItems).toHaveLength(2);
    expect(engineItems?.[0]?.key).toBe("claude");
    expect(connectionItems?.[1]?.key).toBe("streaming");
  });
});
