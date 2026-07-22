import { describe, expect, test } from "bun:test";
import {
  applyTsconfigPathMappings,
  findImportSpecifierForBinding,
  isTsPathAliasSpecifier,
  resolveDefaultPathAliasBases,
  resolvePathAliasImportCandidates,
} from "./monacoPathAliasResolve";

describe("isTsPathAliasSpecifier", () => {
  test("识别 @/ 与 ~/ ", () => {
    expect(isTsPathAliasSpecifier("@/api/system/user")).toBe(true);
    expect(isTsPathAliasSpecifier("~/utils/foo")).toBe(true);
  });

  test("不把 npm scope 当别名", () => {
    expect(isTsPathAliasSpecifier("@scope/pkg")).toBe(false);
    expect(isTsPathAliasSpecifier("@tauri-apps/api")).toBe(false);
  });
});

describe("applyTsconfigPathMappings / resolvePathAliasImportCandidates", () => {
  test("@/* → src/*", () => {
    expect(
      applyTsconfigPathMappings("@/api/system/user", { "@/*": ["src/*"] }),
    ).toEqual(["src/api/system/user"]);
  });

  test("默认 @/ 兜底到 src/", () => {
    expect(resolveDefaultPathAliasBases("@/utils/formatTime")).toEqual([
      "src/utils/formatTime",
      "utils/formatTime",
    ]);
  });

  test("展开扩展名与 index", () => {
    const candidates = resolvePathAliasImportCandidates("@/api/system/user");
    expect(candidates).toContain("src/api/system/user.ts");
    expect(candidates).toContain("src/api/system/user.vue");
    expect(candidates).toContain("src/api/system/user.less");
    expect(candidates).toContain("src/api/system/user/index.ts");
    expect(candidates).toContain("src/api/system/user/index.less");
  });

  test("读取 tsconfig paths 并保留默认兜底", () => {
    const candidates = resolvePathAliasImportCandidates("@/api/ai/chat/conversation", {
      paths: { "@/*": ["src/*"] },
    });
    expect(candidates).toContain("src/api/ai/chat/conversation.ts");
    // tsconfig 命中后仍附带默认 `@/` → 无 src/ 前缀兜底，避免映射与真实目录不一致
    expect(candidates).toContain("api/ai/chat/conversation.ts");
  });

  test("动态 import 的 @/…/*.vue 解析到 src/views 与 views/", () => {
    const candidates = resolvePathAliasImportCandidates("@/views/Profile/Index.vue");
    expect(candidates).toContain("src/views/Profile/Index.vue");
    expect(candidates).toContain("views/Profile/Index.vue");
    expect(candidates).toContain("src/views/Profile/index.vue");
  });
});

describe("findImportSpecifierForBinding", () => {
  test("import * as UserApi from", () => {
    expect(
      findImportSpecifierForBinding(
        "import * as UserApi from '@/api/system/user'",
        "UserApi",
      ),
    ).toBe("@/api/system/user");
  });

  test("named import", () => {
    expect(
      findImportSpecifierForBinding(
        "import { ChatConversationApi, ChatConversationVO } from '@/api/ai/chat/conversation'",
        "ChatConversationApi",
      ),
    ).toBe("@/api/ai/chat/conversation");
    expect(
      findImportSpecifierForBinding(
        "import { ChatConversationApi, ChatConversationVO } from '@/api/ai/chat/conversation'",
        "ChatConversationVO",
      ),
    ).toBe("@/api/ai/chat/conversation");
  });

  test("default + named / as 别名", () => {
    expect(
      findImportSpecifierForBinding("import Foo, { Bar as Baz } from '@/x'", "Foo"),
    ).toBe("@/x");
    expect(
      findImportSpecifierForBinding("import Foo, { Bar as Baz } from '@/x'", "Baz"),
    ).toBe("@/x");
    expect(
      findImportSpecifierForBinding("import Foo, { Bar as Baz } from '@/x'", "Bar"),
    ).toBe("@/x");
  });

  test("不匹配无关标识符", () => {
    expect(
      findImportSpecifierForBinding("import * as UserApi from '@/api/system/user'", "Other"),
    ).toBeNull();
  });
});
