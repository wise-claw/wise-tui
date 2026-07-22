import { describe, expect, test } from "bun:test";
import {
  buildImportNavigationAiPrompt,
  buildImportNavigationSearchQuery,
  extractIdentifierAtColumn,
  findNavigableTypeIdentifierLinks,
  isNavigableTypeIdentifier,
  parseImportNavigationAiPath,
  pickExactBasenameSearchHit,
  takeImportNavigationSearchCandidates,
} from "./monacoImportAiResolve";

describe("buildImportNavigationSearchQuery", () => {
  test("相对路径取末段并去掉扩展名", () => {
    expect(buildImportNavigationSearchQuery("../lib/security-config.ts")).toBe("security-config");
    expect(buildImportNavigationSearchQuery("./foo/bar")).toBe("bar");
  });

  test("去掉 @ 前缀", () => {
    expect(buildImportNavigationSearchQuery("@utils/repositoryType")).toBe("repositoryType");
  });

  test("仓库根相对路径", () => {
    expect(buildImportNavigationSearchQuery("src/components/ClaudeChat")).toBe("ClaudeChat");
  });

  test("空串", () => {
    expect(buildImportNavigationSearchQuery("   ")).toBe("");
  });

  test("Java 类名保持原样", () => {
    expect(buildImportNavigationSearchQuery("PayAppService")).toBe("PayAppService");
  });
});

describe("findNavigableTypeIdentifierLinks", () => {
  test("标出 PayAppService", () => {
    const links = findNavigableTypeIdentifierLinks(
      "    private PayAppService payAppService;\n",
    );
    expect(links.map((l) => l.word)).toContain("PayAppService");
    const hit = links.find((l) => l.word === "PayAppService");
    expect(hit?.range.startLineNumber).toBe(1);
    expect(hit?.range.startColumn).toBe(13);
  });
});

describe("isNavigableTypeIdentifier / extractIdentifierAtColumn", () => {
  test("PayAppService 可跳转", () => {
    expect(isNavigableTypeIdentifier("PayAppService")).toBe(true);
  });

  test("camelCase / 关键字不可跳转", () => {
    expect(isNavigableTypeIdentifier("payAppService")).toBe(false);
    expect(isNavigableTypeIdentifier("private")).toBe(false);
    expect(isNavigableTypeIdentifier("get")).toBe(false);
  });

  test("从字段声明行取出类型名", () => {
    const line = "    private PayAppService payAppService;";
    const hit = extractIdentifierAtColumn(line, 20);
    expect(hit?.word).toBe("PayAppService");
    expect(isNavigableTypeIdentifier(hit!.word)).toBe(true);
  });
});

describe("pickExactBasenameSearchHit", () => {
  test("唯一文件名命中", () => {
    expect(
      pickExactBasenameSearchHit("security-config", [
        { path: "src/lib/security-config.ts", isDir: false },
        { path: "src/lib", isDir: true },
      ]),
    ).toBe("src/lib/security-config.ts");
  });

  test("Java 同名类文件命中", () => {
    expect(
      pickExactBasenameSearchHit("PayAppService", [
        { path: "yudao-module-pay/.../PayAppService.java", isDir: false },
        { path: "yudao-module-pay/.../PayAppServiceImpl.java", isDir: false },
      ]),
    ).toBe("yudao-module-pay/.../PayAppService.java");
  });

  test("多个同名则不直跳", () => {
    expect(
      pickExactBasenameSearchHit("foo", [
        { path: "a/foo.ts", isDir: false },
        { path: "b/foo.tsx", isDir: false },
      ]),
    ).toBeNull();
  });
});

describe("takeImportNavigationSearchCandidates", () => {
  test("过滤目录并截断", () => {
    const hits = [
      { path: "a/one.ts", isDir: false },
      { path: "a", isDir: true },
      { path: "b/two.ts", isDir: false },
      { path: "c/three.ts", isDir: false },
    ];
    expect(takeImportNavigationSearchCandidates(hits, 2)).toEqual(["a/one.ts", "b/two.ts"]);
  });
});

describe("parseImportNavigationAiPath", () => {
  const allowed = ["src/lib/security-config.ts", "src/utils/foo.ts"];

  test("精确命中", () => {
    expect(parseImportNavigationAiPath("src/lib/security-config.ts", allowed)).toBe(
      "src/lib/security-config.ts",
    );
  });

  test("去掉编号与围栏", () => {
    expect(parseImportNavigationAiPath("```\n1. src/utils/foo.ts\n```", allowed)).toBe(
      "src/utils/foo.ts",
    );
  });

  test("NONE", () => {
    expect(parseImportNavigationAiPath("NONE", allowed)).toBeNull();
  });

  test("不在候选中", () => {
    expect(parseImportNavigationAiPath("src/other.ts", allowed)).toBeNull();
  });
});

describe("buildImportNavigationAiPrompt", () => {
  test("包含候选与约束", () => {
    const prompt = buildImportNavigationAiPrompt({
      fromRelativePath: "src/a.ts",
      specifier: "../lib/security-config",
      kind: "import",
      lineContext: 'import x from "../lib/security-config"',
      candidates: ["src/lib/security-config.ts"],
    });
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("../lib/security-config");
    expect(prompt).toContain("1. src/lib/security-config.ts");
    expect(prompt).toContain("NONE");
  });

  test("symbol 提示同名源文件", () => {
    const prompt = buildImportNavigationAiPrompt({
      fromRelativePath: "PayTransferController.java",
      specifier: "PayAppService",
      kind: "symbol",
      lineContext: "private PayAppService payAppService;",
      candidates: ["module/PayAppService.java"],
    });
    expect(prompt).toContain("类型/类名");
    expect(prompt).toContain("PayAppService");
  });
});
