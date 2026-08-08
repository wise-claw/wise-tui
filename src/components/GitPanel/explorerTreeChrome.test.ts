import { describe, expect, test } from "bun:test";
import {
  MATERIAL_ICONS_BASE_URL,
  materialIconSrc,
  resolveExplorerFileMaterialIcon,
  resolveExplorerFolderMaterialIcon,
} from "./explorerTreeChrome";

describe("resolveExplorerFileMaterialIcon", () => {
  test("maps common source files to Material Icon Theme names", () => {
    expect(resolveExplorerFileMaterialIcon("App.tsx")).toBe("react_ts");
    expect(resolveExplorerFileMaterialIcon("index.ts")).toBe("typescript");
    expect(resolveExplorerFileMaterialIcon("App.css")).toBe("css");
    expect(resolveExplorerFileMaterialIcon("README.md")).toBe("readme");
    expect(resolveExplorerFileMaterialIcon("package.json")).toBe("nodejs");
  });
});

describe("resolveExplorerFolderMaterialIcon", () => {
  test("maps well-known folders and open variants", () => {
    expect(resolveExplorerFolderMaterialIcon("src", false)).toBe("folder-src");
    expect(resolveExplorerFolderMaterialIcon("src", true)).toBe("folder-src-open");
    expect(resolveExplorerFolderMaterialIcon("hooks", false)).toBe("folder-hook");
    expect(resolveExplorerFolderMaterialIcon("hooks", true)).toBe("folder-hook-open");
    expect(resolveExplorerFolderMaterialIcon("node_modules", false)).toBe("folder-node");
    expect(resolveExplorerFolderMaterialIcon(".vscode", false)).toBe("folder-vscode");
  });

  test("falls back to generic folder icons", () => {
    expect(resolveExplorerFolderMaterialIcon("zzzz-unknown-folder-xyz", false)).toBe("folder");
    expect(resolveExplorerFolderMaterialIcon("zzzz-unknown-folder-xyz", true)).toBe("folder-open");
  });
});

describe("materialIconSrc", () => {
  test("builds URL under the static mount", () => {
    expect(materialIconSrc("typescript")).toBe(`${MATERIAL_ICONS_BASE_URL}/typescript.svg`);
    expect(materialIconSrc("folder-src-open")).toBe(`${MATERIAL_ICONS_BASE_URL}/folder-src-open.svg`);
  });
});
