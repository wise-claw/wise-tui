import { describe, expect, test } from "bun:test";
import { findLoosePathLinks } from "./monacoImportNavigation";

describe("findLoosePathLinks — 裸路径/@ 路径识别", () => {
  test("识别 @<path> 形式的 mention", () => {
    const links = findLoosePathLinks("see @utils/repositoryType for details");
    expect(links).toContainEqual(
      expect.objectContaining({ specifier: "@utils/repositoryType" }),
    );
  });

  test("识别 @scope/pkg/x 形式的多段路径", () => {
    const links = findLoosePathLinks("open @tauri-apps/api/event.ts");
    expect(links).toContainEqual(
      expect.objectContaining({ specifier: "@tauri-apps/api/event.ts" }),
    );
  });

  test("识别 ./foo 与 ../foo 相对裸路径", () => {
    const links = findLoosePathLinks("import this ./legacy or ../shared/util");
    const specs = links.map((l) => l.specifier);
    expect(specs).toContain("./legacy");
    expect(specs).toContain("../shared/util");
  });

  test("识别含后缀的相对裸路径", () => {
    const links = findLoosePathLinks("look at ../shared/util.ts");
    expect(links).toContainEqual(
      expect.objectContaining({ specifier: "../shared/util.ts" }),
    );
  });

  test("识别 src/foo/bar 形式的绝对裸路径", () => {
    const links = findLoosePathLinks("see src/components/ClaudeChat for context");
    expect(links).toContainEqual(
      expect.objectContaining({ specifier: "src/components/ClaudeChat" }),
    );
  });

  test("不识别 http:// / https:// / file:// / monaco://", () => {
    const links = findLoosePathLinks(
      "visit https://example.com/foo or file:///tmp/bar or monaco://baz",
    );
    expect(links).toEqual([]);
  });

  test("不识别纯单词（不含斜杠）", () => {
    const links = findLoosePathLinks("the import statement");
    expect(links).toEqual([]);
  });

  test("不识别 import 语句里的引号路径（交给 findImportLinks）", () => {
    const links = findLoosePathLinks('import x from "./foo.ts";');
    // 关键词 `from` 紧邻之前的 loose token 应被排除
    expect(links.map((l) => l.specifier)).not.toContain("./foo.ts");
  });

  test("不识别邮箱", () => {
    const links = findLoosePathLinks("mail me at user.name@example.com please");
    expect(links).toEqual([]);
  });

  test("range 的 line/column 落在正确位置", () => {
    const text = "see @utils/foo please";
    const links = findLoosePathLinks(text);
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.range.startLineNumber).toBe(1);
    expect(link.range.startColumn).toBe(5);
    expect(link.range.endColumn).toBe(15);
  });

  test("多行文本按行号统计", () => {
    const text = "first line\nfoo/bar on line 2\n\n@utils/three";
    const links = findLoosePathLinks(text);
    expect(links).toContainEqual(expect.objectContaining({ specifier: "foo/bar" }));
    expect(links).toContainEqual(expect.objectContaining({ specifier: "@utils/three" }));
    const threeLink = links.find((l) => l.specifier === "@utils/three");
    expect(threeLink?.range.startLineNumber).toBe(4);
  });
});