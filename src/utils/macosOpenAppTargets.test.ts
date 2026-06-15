import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OPEN_APP_TARGETS,
  MAC_BASE_OPEN_APP_TARGETS,
} from "../components/OpenAppMenu/constants";
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
      "qoder",
      "trae",
      "terminal",
      "ghostty",
    ]);
    expect(targets.find((item) => item.id === "ghostty")?.appName).toBe("Ghostty");
  });

  test("falls back to static list when detection is empty", () => {
    const targets = mergeMacOpenAppTargets([]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((item) => item.id === "vscode")).toBe(true);
  });

  test("static default list exposes Qoder and Trae in expected positions", () => {
    // The static default list is platform-aware at module-load time (macOS
    // uses MAC_BASE_OPEN_APP_TARGETS; non-mac adds a Terminal + Ghostty
    // entry alongside the IDEs). Qoder and Trae should sit immediately
    // after IntelliJ in both shapes, so the order is stable.
    const ids = DEFAULT_OPEN_APP_TARGETS.map((item) => item.id);
    expect(ids).toContain("qoder");
    expect(ids).toContain("trae");

    const intellijIdx = ids.indexOf("intellij");
    const qoderIdx = ids.indexOf("qoder");
    const traeIdx = ids.indexOf("trae");
    expect(intellijIdx).toBeGreaterThanOrEqual(0);
    expect(qoderIdx).toBe(intellijIdx + 1);
    expect(traeIdx).toBe(intellijIdx + 2);
  });

  test("Qoder and Trae entries have a populated kind-specific field", () => {
    // Each entry is configured for exactly one dispatch path:
    //   - macOS: `kind: "app"` with `appName`
    //   - non-mac: `kind: "command"` with `command`
    // Verify that the populated field matches the declared kind, so the
    // OpenAppMenu enable check (`canOpenAppTarget`) treats them as valid.
    for (const id of ["qoder", "trae"] as const) {
      const entry = DEFAULT_OPEN_APP_TARGETS.find((item) => item.id === id);
      expect(entry).toBeDefined();
      if (!entry) continue;
      if (entry.kind === "app") {
        expect(entry.appName?.trim().length ?? 0).toBeGreaterThan(0);
        expect(entry.command?.trim().length ?? 0).toBe(0);
      } else if (entry.kind === "command") {
        expect(entry.command?.trim().length ?? 0).toBeGreaterThan(0);
        expect(entry.appName?.trim().length ?? 0).toBe(0);
      } else {
        throw new Error(`Unexpected kind for ${id}: ${entry.kind}`);
      }
    }
  });
});
