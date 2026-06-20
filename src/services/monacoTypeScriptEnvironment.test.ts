import { describe, expect, test } from "bun:test";
import {
  extractMonacoTypeScriptModuleSpecifiers,
  resolveImportSpecifierToRelativePath,
  resolveMonacoRepositoryRelativeImportCandidates,
} from "./monacoTypeScriptEnvironment";

describe("Monaco TypeScript repository import helpers", () => {
  test("resolves Wise split relative imports from a source file", () => {
    expect(resolveMonacoRepositoryRelativeImportCandidates("src/AppImpl.tsx", "./utils/repositoryType")).toContain(
      "src/utils/repositoryType.ts",
    );
  });

  test("resolves parent-directory constants imports from service files", () => {
    expect(
      resolveMonacoRepositoryRelativeImportCandidates(
        "src/services/backgroundInvocationSnapshot.ts",
        "../constants/directBatchInvocationLog",
      ),
    ).toContain("src/constants/directBatchInvocationLog.ts");
  });

  test("resolves NodeNext .js imports to .ts source files", () => {
    expect(
      resolveMonacoRepositoryRelativeImportCandidates("src/cli/ask.ts", "../lib/security-config.js"),
    ).toEqual(
      expect.arrayContaining(["src/lib/security-config.js", "src/lib/security-config.ts"]),
    );
  });

  test("maps .js import specifiers to import-relative model paths", () => {
    expect(resolveImportSpecifierToRelativePath("src/cli/ask.ts", "../lib/security-config.js")).toBe(
      "src/lib/security-config.js",
    );
  });

  test("extracts static, dynamic, and require module specifiers", () => {
    expect(
      extractMonacoTypeScriptModuleSpecifiers(`
        import { listen } from "@tauri-apps/api/event";
        import type { Repository } from "../types";
        export { value } from "./utils/repositoryType";
        const lazy = import("../constants/directBatchInvocationLog");
        const dep = require("./legacy");
      `),
    ).toEqual([
      "@tauri-apps/api/event",
      "../types",
      "./utils/repositoryType",
      "../constants/directBatchInvocationLog",
      "./legacy",
    ]);
  });
});
