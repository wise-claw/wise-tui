import { describe, expect, test } from "bun:test";
import {
  applyWiseTypeScriptDefaults,
  buildMonacoLargeModuleStub,
  extractMonacoTypeScriptModuleSpecifiers,
  isScopePackageSpecifier,
  resolveImportSpecifierToRelativePath,
  resolveMonacoRepositoryRelativeImportCandidates,
  resolvePathClickCandidates,
  resolveScopePackageCandidates,
  RESOLVABLE_INDEX_EXTENSIONS,
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

  test("./dir 只在 ts/tsx/js/jsx 上做 index 兜底，不生成 index.json/index.d.ts", () => {
    const candidates = resolveMonacoRepositoryRelativeImportCandidates("src/App.tsx", "./dir");
    for (const ext of RESOLVABLE_INDEX_EXTENSIONS) {
      expect(candidates).toContain(`src/dir/index${ext}`);
    }
    expect(candidates).not.toContain("src/dir/index.json");
    expect(candidates).not.toContain("src/dir/index.d.ts");
  });

  test("./path 命中所有源码后缀自身候选", () => {
    const candidates = resolveMonacoRepositoryRelativeImportCandidates("src/App.tsx", "./path");
    expect(candidates).toEqual(
      expect.arrayContaining([
        "src/path.ts",
        "src/path.tsx",
        "src/path.js",
        "src/path.jsx",
        "src/path.json",
        "src/path.d.ts",
      ]),
    );
  });

  test("./pkg.json 自身候选不被 .ts 替代", () => {
    expect(
      resolveMonacoRepositoryRelativeImportCandidates("src/A.ts", "./pkg.json"),
    ).toEqual(expect.arrayContaining(["src/pkg.json"]));
  });
});

describe("resolvePathClickCandidates — 裸路径点击", () => {
  test("@utils/foo 字面视作仓库相对路径（fromDir 拼接）", () => {
    expect(
      resolvePathClickCandidates("src/App.tsx", "@utils/foo"),
    ).toEqual(expect.arrayContaining(["src/@utils/foo.ts", "src/@utils/foo/index.tsx"]));
  });

  test("./relative 走 fromDir 拼接", () => {
    expect(
      resolvePathClickCandidates("src/services/a.ts", "../lib/security-config"),
    ).toEqual(
      expect.arrayContaining([
        "src/lib/security-config.ts",
        "src/lib/security-config.tsx",
        "src/lib/security-config/index.ts",
      ]),
    );
    expect(
      resolvePathClickCandidates("src/services/a.ts", "../lib/security-config"),
    ).not.toContain("src/lib/security-config/index.json");
  });

  test("src/foo（绝对裸路径）视作仓库根相对，不拼接 fromDir", () => {
    expect(
      resolvePathClickCandidates("src/services/a.ts", "src/foo/bar"),
    ).toEqual(expect.arrayContaining(["src/foo/bar.ts", "src/foo/bar/index.tsx"]));
    // 不应出现 src/services/src/foo/bar 这样的拼接过深路径
    expect(
      resolvePathClickCandidates("src/services/a.ts", "src/foo/bar"),
    ).not.toContain("src/services/src/foo/bar.ts");
  });

  test("路由目录路径优先 index.tsx，并补 src/ 前缀", () => {
    const candidates = resolvePathClickCandidates(
      "src/routes.ts",
      "pages/ProjectManagement/ProjectDetail",
    );
    expect(candidates[0]).toBe("src/pages/ProjectManagement/ProjectDetail/index.tsx");
    expect(candidates).toContain("src/pages/ProjectManagement/ProjectDetail/index.ts");
    expect(candidates).toContain("pages/ProjectManagement/ProjectDetail/index.tsx");
    expect(candidates).toContain("pages/ProjectManagement/ProjectDetail.tsx");
  });

  test("以 index.tsx 结尾的路径直接作为候选", () => {
    expect(
      resolvePathClickCandidates(
        "src/routes.ts",
        "pages/ProjectManagement/ProjectDetail/index.tsx",
      ),
    ).toEqual([
      "src/pages/ProjectManagement/ProjectDetail/index.tsx",
      "pages/ProjectManagement/ProjectDetail/index.tsx",
    ]);
  });

  test("./pkg.json 命中自身且不被 .ts 替代", () => {
    expect(
      resolvePathClickCandidates("src/A.ts", "./pkg.json"),
    ).toEqual(expect.arrayContaining(["src/pkg.json"]));
  });

  test("./pkg.ts 命中自身但不展开 index.*", () => {
    const candidates = resolvePathClickCandidates("src/A.ts", "./pkg.ts");
    expect(candidates).toContain("src/pkg.ts");
    expect(candidates).not.toContain("src/pkg.ts/index.ts");
  });

  test("样式后缀 less/scss/sass/css 可作为点击目标", () => {
    expect(
      resolvePathClickCandidates("src/pages/A.tsx", "./index.less"),
    ).toEqual(expect.arrayContaining(["src/pages/index.less"]));
    expect(
      resolvePathClickCandidates("src/a.ts", "styles/theme.scss"),
    ).toEqual(expect.arrayContaining(["styles/theme.scss", "src/styles/theme.scss"]));
    expect(
      resolvePathClickCandidates("src/a.ts", "assets/main.css"),
    ).toContain("src/assets/main.css");
    expect(
      resolvePathClickCandidates("src/a.ts", "./vars.sass"),
    ).toContain("src/vars.sass");
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

describe("isScopePackageSpecifier", () => {
  test("识别 @scope/pkg", () => {
    expect(isScopePackageSpecifier("@tauri-apps/api")).toBe(true);
  });
  test("识别 @scope/pkg/sub/path", () => {
    expect(isScopePackageSpecifier("@tauri-apps/api/core")).toBe(true);
  });
  test("不识别裸 @scope", () => {
    expect(isScopePackageSpecifier("@tauri-apps")).toBe(false);
  });
  test("不识别普通相对路径", () => {
    expect(isScopePackageSpecifier("./foo")).toBe(false);
    expect(isScopePackageSpecifier("../foo")).toBe(false);
  });
  test("不识别非 scope 名", () => {
    expect(isScopePackageSpecifier("lodash")).toBe(false);
  });
});

describe("resolveScopePackageCandidates — npm scope 包", () => {
  test("@tauri-apps/api/core 生成 node_modules 候选", () => {
    const candidates = resolveScopePackageCandidates("@tauri-apps/api/core");
    expect(candidates).toEqual(
      expect.arrayContaining([
        "node_modules/@tauri-apps/api/core.ts",
        "node_modules/@tauri-apps/api/core.tsx",
        "node_modules/@tauri-apps/api/core.js",
        "node_modules/@tauri-apps/api/core.jsx",
        "node_modules/@tauri-apps/api/core.d.ts",
        "node_modules/@tauri-apps/api/core/index.ts",
        "node_modules/@tauri-apps/api/core/index.tsx",
        "node_modules/@tauri-apps/api/core/index.js",
        "node_modules/@tauri-apps/api/core/index.jsx",
      ]),
    );
    // 不应生成 index.json / index.d.ts 兜底
    expect(candidates).not.toContain("node_modules/@tauri-apps/api/core/index.json");
    expect(candidates).not.toContain("node_modules/@tauri-apps/api/core/index.d.ts");
  });

  test("@tauri-apps/api/core.d.ts 带扩展名命中自身且不被 .ts 替代", () => {
    const candidates = resolveScopePackageCandidates("@tauri-apps/api/core.d.ts");
    expect(candidates).toContain("node_modules/@tauri-apps/api/core.d.ts");
    // 不应再追加 src/.../core.ts 之类
    expect(candidates).toEqual(["node_modules/@tauri-apps/api/core.d.ts"]);
  });

  test("非 scope 包返回空", () => {
    expect(resolveScopePackageCandidates("./foo")).toEqual([]);
    expect(resolveScopePackageCandidates("lodash")).toEqual([]);
    expect(resolveScopePackageCandidates("@scope")).toEqual([]);
  });
});
