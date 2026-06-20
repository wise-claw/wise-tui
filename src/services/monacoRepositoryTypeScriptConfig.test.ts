import { describe, expect, test } from "bun:test";
import {
  extractTypeScriptReferencePaths,
  mapTsconfigCompilerOptionsToMonaco,
  parseRepositoryTsconfigJson,
} from "./monacoRepositoryTypeScriptConfig";

describe("monacoRepositoryTypeScriptConfig", () => {
  test("strips json comments before parsing tsconfig", () => {
    const parsed = parseRepositoryTsconfigJson(`{
      // line comment
      "compilerOptions": {
        /* block comment */
        "module": "NodeNext"
      }
    }`);
    expect(parsed.compilerOptions?.module).toBe("NodeNext");
  });

  test("maps NodeNext compiler options to monaco runtime enums", () => {
    const mapped = mapTsconfigCompilerOptionsToMonaco(
      {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        types: ["node"],
      },
      {
        ScriptTarget: { ES2022: 9 },
        ModuleKind: { NodeNext: 199 },
        ModuleResolutionKind: { NodeNext: 100 },
        JsxEmit: { ReactJSX: 4 },
      },
    );
    expect(mapped.module).toBe(199);
    expect(mapped.moduleResolution).toBe(100);
    expect(mapped.target).toBe(9);
    expect(mapped.strict).toBe(true);
  });

  test("extracts triple-slash reference paths", () => {
    expect(
      extractTypeScriptReferencePaths(`/// <reference path="globals.d.ts" />\n/// <reference path="compatibility/index.d.ts" />`),
    ).toEqual(["globals.d.ts", "compatibility/index.d.ts"]);
  });
});
