import { describe, expect, test } from "bun:test";
import { defaultExtensionLibraryCaptureName } from "./extensionLibraryCaptureName";

describe("defaultExtensionLibraryCaptureName", () => {
  test("maps claude settings.json to project-hooks", () => {
    expect(defaultExtensionLibraryCaptureName(".claude/settings.json")).toBe("project-hooks");
  });

  test("uses file stem for generic paths", () => {
    expect(defaultExtensionLibraryCaptureName("scripts/deploy.sh")).toBe("deploy");
  });
});
