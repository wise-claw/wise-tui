import { describe, expect, test } from "bun:test";
import type { Repository } from "../../types";
import {
  effectiveSddMode,
  resolveAutoSddMode,
  type SddSignals,
} from "./sddModeDetector";

function signals(overrides: Partial<SddSignals> = {}): SddSignals {
  return {
    hasTrellisTasks: false,
    hasTrellisSpec: false,
    hasOpenSpec: false,
    hasGenericSpec: false,
    ...overrides,
  };
}

function repo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: "r",
    path: "/r",
    repositoryType: "frontend",
    createdAt: "0",
    updatedAt: "0",
    ...overrides,
  };
}

describe("resolveAutoSddMode", () => {
  test("returns project_owned when .trellis/tasks/ exists", () => {
    expect(resolveAutoSddMode(signals({ hasTrellisTasks: true }))).toBe("project_owned");
  });
  test("returns project_owned when .trellis/spec/ exists", () => {
    expect(resolveAutoSddMode(signals({ hasTrellisSpec: true }))).toBe("project_owned");
  });
  test("returns project_owned when .openspec/ exists", () => {
    expect(resolveAutoSddMode(signals({ hasOpenSpec: true }))).toBe("project_owned");
  });
  test("returns project_owned when .spec/ exists", () => {
    expect(resolveAutoSddMode(signals({ hasGenericSpec: true }))).toBe("project_owned");
  });
  test("returns wise_trellis when no signal", () => {
    expect(resolveAutoSddMode(signals())).toBe("wise_trellis");
  });
});

describe("effectiveSddMode", () => {
  test("uses explicit non-auto mode regardless of signals", () => {
    expect(effectiveSddMode(repo({ sddMode: "off" }), signals({ hasTrellisTasks: true }))).toBe(
      "off",
    );
    expect(effectiveSddMode(repo({ sddMode: "wise_trellis" }), signals())).toBe("wise_trellis");
    expect(effectiveSddMode(repo({ sddMode: "project_owned" }), signals())).toBe("project_owned");
  });

  test("falls through 'auto' to detector result", () => {
    expect(
      effectiveSddMode(repo({ sddMode: "auto" }), signals({ hasOpenSpec: true })),
    ).toBe("project_owned");
    expect(effectiveSddMode(repo({ sddMode: "auto" }), signals())).toBe("wise_trellis");
  });

  test("treats undefined sddMode as auto", () => {
    expect(effectiveSddMode(repo(), signals({ hasTrellisTasks: true }))).toBe("project_owned");
    expect(effectiveSddMode(repo(), signals())).toBe("wise_trellis");
  });
});
