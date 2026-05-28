import { describe, expect, test } from "bun:test";
import {
  detectedMacTerminalToOpenTarget,
  isTerminalOpenAppId,
} from "./macosTerminal";

describe("macosTerminal", () => {
  test("isTerminalOpenAppId recognizes catalog ids", () => {
    expect(isTerminalOpenAppId("iterm")).toBe(true);
    expect(isTerminalOpenAppId("vscode")).toBe(false);
  });

  test("detectedMacTerminalToOpenTarget maps to app kind", () => {
    expect(
      detectedMacTerminalToOpenTarget({
        id: "warp",
        label: "Warp",
        appName: "Warp",
      }),
    ).toEqual({
      id: "warp",
      label: "Warp",
      kind: "app",
      appName: "Warp",
      args: [],
    });
  });
});
