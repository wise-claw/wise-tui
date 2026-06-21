import { describe, expect, test } from "bun:test";
import {
  applyWiseTypeScriptDefaults,
  buildMonacoLargeModuleStub,
  extractMonacoTypeScriptModuleSpecifiers,
  resolveImportSpecifierToRelativePath,
  resolveMonacoRepositoryRelativeImportCandidates,
  WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES,
  type MonacoCompilerOptions,
  type MonacoLanguageDefaults,
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

  test("resolves App.tsx dynamic import to AppImpl.tsx", () => {
    expect(resolveMonacoRepositoryRelativeImportCandidates("src/App.tsx", "./AppImpl")).toContain(
      "src/AppImpl.tsx",
    );
    expect(resolveImportSpecifierToRelativePath("src/App.tsx", "./AppImpl")).toBe("src/AppImpl");
  });

  test("large module stub exports a default component type", () => {
    expect(buildMonacoLargeModuleStub("src/AppImpl.tsx")).toContain("export default");
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

/**
 * 构造一个记录副作用、符合 MonacoLanguageDefaults 形状的最小 mock。
 * 仅用于验证 applyWiseTypeScriptDefaults 写入了哪些诊断/编译选项。
 */
function createMockDefaults(): MonacoLanguageDefaults & {
  snapshot: {
    compilerOptions: MonacoCompilerOptions;
    diagnosticsOptions: Record<string, unknown>;
    eagerModelSync: boolean | null;
  };
} {
  let compilerOptions: MonacoCompilerOptions = {};
  let diagnosticsOptions: Record<string, unknown> = {};
  let eagerModelSync: boolean | null = null;
  return {
    getCompilerOptions: () => compilerOptions,
    setCompilerOptions: (options) => {
      compilerOptions = { ...compilerOptions, ...options };
    },
    getDiagnosticsOptions: () => diagnosticsOptions,
    setDiagnosticsOptions: (options) => {
      diagnosticsOptions = { ...diagnosticsOptions, ...options };
    },
    addExtraLib: () => ({ dispose: () => {} }),
    setEagerModelSync: (value) => {
      eagerModelSync = value;
    },
    snapshot: {
      get compilerOptions() {
        return compilerOptions;
      },
      get diagnosticsOptions() {
        return diagnosticsOptions;
      },
      get eagerModelSync() {
        return eagerModelSync;
      },
    },
  } as MonacoLanguageDefaults & {
    snapshot: {
      compilerOptions: MonacoCompilerOptions;
      diagnosticsOptions: Record<string, unknown>;
      eagerModelSync: boolean | null;
    };
  };
}

describe("WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES", () => {
  test("包含依赖解析类误报码", () => {
    // 这些码在依赖图不全时几乎全是误报，是浏览场景标红的主要来源。
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).toContain(2307); // Cannot find module
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).toContain(2305); // no exported member
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).toContain(7016); // no declaration file
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).toContain(2688); // no type definition file
  });

  test("不含会误伤真错误的码", () => {
    // 2304 Cannot find name：多为真实拼写错误，屏蔽会吞掉高频真问题。
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).not.toContain(2304);
    // 6133/6132 unused：由 noUnusedLocals/noUnusedParameters 控制，
    // 不在此屏蔽以尊重仓库 tsconfig 自身的 unused 配置。
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).not.toContain(6133);
    expect(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).not.toContain(6132);
  });

  test("码值唯一", () => {
    expect(new Set(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES).size).toBe(
      WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES.length,
    );
  });
});

describe("applyWiseTypeScriptDefaults", () => {
  test("关闭建议诊断、保留语法与语义诊断、注入误报码屏蔽", () => {
    const defaults = createMockDefaults();
    applyWiseTypeScriptDefaults(defaults, { strict: true });

    const diagnostics = defaults.snapshot.diagnosticsOptions;
    expect(diagnostics.noSyntaxValidation).toBe(false);
    expect(diagnostics.noSemanticValidation).toBe(false);
    // 建议诊断（可转 const 等）在浏览场景为噪音，应关闭。
    expect(diagnostics.noSuggestionDiagnostics).toBe(true);
    expect(diagnostics.onlyVisible).toBe(true);
    expect(diagnostics.diagnosticCodesToIgnore).toEqual(WISE_MONACO_TS_IGNORED_DIAGNOSTIC_CODES);
  });

  test("合并而非覆盖已有诊断选项", () => {
    const defaults = createMockDefaults();
    // 模拟此前已设置的选项，确保 applyWiseTypeScriptDefaults 是合并语义。
    defaults.setDiagnosticsOptions({ onlyVisible: false, customFlag: true });
    applyWiseTypeScriptDefaults(defaults, {});

    const diagnostics = defaults.snapshot.diagnosticsOptions;
    expect(diagnostics.customFlag).toBe(true);
    // onlyVisible 应被覆盖为 true。
    expect(diagnostics.onlyVisible).toBe(true);
  });

  test("合并已有编译选项并启用 eagerModelSync", () => {
    const defaults = createMockDefaults();
    defaults.setCompilerOptions({ target: 1 });
    applyWiseTypeScriptDefaults(defaults, { strict: true, jsx: 4 });

    const compiler = defaults.snapshot.compilerOptions;
    expect(compiler.target).toBe(1); // 保留既有
    expect(compiler.strict).toBe(true); // 合并新值
    expect(compiler.jsx).toBe(4);
    expect(defaults.snapshot.eagerModelSync).toBe(true);
  });
});
