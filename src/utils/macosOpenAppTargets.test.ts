import { describe, expect, test } from "bun:test";
import { MAC_BASE_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import { buildMacOpenAppTargets, mergeMacOpenAppTargets } from "./macosOpenAppTargets";

describe("macosOpenAppTargets", () => {
  test("injects detected terminals after mac base targets", () => {
    const targets = buildMacOpenAppTargets([
      { id: "terminal", label: "终端", appName: "Terminal" },
      { id: "ghostty", label: "Ghostty", appName: "Ghostty" },
    ]);
    expect(targets.slice(0, MAC_BASE_OPEN_APP_TARGETS.length)).toEqual(MAC_BASE_OPEN_APP_TARGETS);
    expect(targets.map((item) => item.id)).toEqual([
      "vscode",
      "cursor",
      "codefuse",
      "finder",
      "intellij",
      "terminal",
      "ghostty",
    ]);
    expect(targets.find((item) => item.id === "ghostty")?.appName).toBe("Ghostty");
  });

  test("falls back when detection is empty", () => {
    const targets = mergeMacOpenAppTargets([]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((item) => item.id === "vscode")).toBe(true);
  });
});
