import { describe, expect, test } from "bun:test";
import {
  resolveProjectSddModeForStack,
  sddStackModeFromProjectSddMode,
  sddStackModeFromRepositorySddMode,
  sddStackModeToBootstrap,
  sddStackModeToSddMode,
} from "./sddStackMode";

describe("sddStackMode", () => {
  test("maps stack modes to sddMode and bootstrap", () => {
    expect(sddStackModeToSddMode("wise_trellis")).toBe("wise_trellis");
    expect(sddStackModeToSddMode("trellis")).toBe("project_owned");
    expect(sddStackModeToSddMode("omc")).toBe("project_owned");
    expect(sddStackModeToBootstrap("wise_trellis")).toMatchObject({ trellis: true, trellisInit: false, omc: false });
    expect(sddStackModeToBootstrap("trellis")).toMatchObject({ trellis: false, trellisInit: true, omc: false });
    expect(sddStackModeToBootstrap("omc")).toMatchObject({ trellis: false, trellisInit: false, omc: true });
  });

  test("infers stack mode from repository sddMode", () => {
    expect(sddStackModeFromRepositorySddMode("wise_trellis")).toBe("wise_trellis");
    expect(sddStackModeFromRepositorySddMode("off")).toBe("off");
    expect(sddStackModeFromRepositorySddMode(undefined)).toBe("auto");
  });

  test("maps project sddMode and stack save", () => {
    expect(sddStackModeFromProjectSddMode("wise_trellis")).toBe("wise_trellis");
    expect(sddStackModeFromProjectSddMode("project_owned")).toBe("project_owned");
    expect(
      resolveProjectSddModeForStack("omc", {
        hasTrellisTasks: false,
        hasTrellisSpec: false,
        hasOpenSpec: false,
        hasGenericSpec: false,
      }),
    ).toBe("project_owned");
  });
});
