import { describe, expect, test } from "bun:test";
import {
  createWorkspaceRequirementItem,
  deriveRequirementTitle,
  extractRequirementsFromMemoMarkdown,
  formatRequirementDispatchPrompt,
  parseWorkspaceRequirementsPayload,
  sortWorkspaceRequirementItems,
} from "./workspaceRequirements";
import {
  countMarkdownImages,
  extractAbsoluteImagePathsFromMarkdown,
  stripMarkdownImages,
} from "../services/workspaceRequirementDispatch";
import { prefixExecutionEnvironmentMention } from "../constants/pendingTaskQueueEvents";

describe("workspaceRequirements", () => {
  test("parseWorkspaceRequirementsPayload ignores invalid payload", () => {
    expect(parseWorkspaceRequirementsPayload(null).items).toEqual([]);
    expect(parseWorkspaceRequirementsPayload("{").items).toEqual([]);
    expect(parseWorkspaceRequirementsPayload(JSON.stringify({ version: 2, items: [] })).items).toEqual(
      [],
    );
  });

  test("parseWorkspaceRequirementsPayload migrates legacy description", () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        {
          id: "a",
          title: "Alpha",
          description: "legacy note",
          status: "open",
          createdAt: 1,
          updatedAt: 2,
          sortOrder: 1,
        },
      ],
    });
    const parsed = parseWorkspaceRequirementsPayload(raw);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.bodyMarkdown).toBe("legacy note");
    expect(parsed.items[0]!.imagePaths).toEqual([]);
  });

  test("extractRequirementsFromMemoMarkdown reads checklist and bullets", () => {
    const md = `# 备忘录

- [ ] 自动分发文章的平台
- [x] 拥有一个自己的商城
* 做视频号，引流
普通段落忽略
- AI资讯平台
`;
    const items = extractRequirementsFromMemoMarkdown(md);
    expect(items.map((i) => i.title)).toEqual([
      "自动分发文章的平台",
      "做视频号，引流",
      "AI资讯平台",
      "拥有一个自己的商城",
    ]);
    expect(items.find((i) => i.title.includes("商城"))?.status).toBe("done");
  });

  test("deriveRequirementTitle skips image-only lines", () => {
    expect(deriveRequirementTitle("![shot](/tmp/a.png)\n\n建一个商城")).toBe("建一个商城");
    expect(deriveRequirementTitle("## 标题需求\n正文")).toBe("标题需求");
  });

  test("formatRequirementDispatchPrompt includes body", () => {
    const item = createWorkspaceRequirementItem("## 建商城\n\n需要支付与库存");
    expect(formatRequirementDispatchPrompt(item)).toContain("建商城");
    expect(formatRequirementDispatchPrompt(item)).toContain("需要支付与库存");
  });

  test("sortWorkspaceRequirementItems puts open before done", () => {
    const done = createWorkspaceRequirementItem("done");
    done.status = "done";
    done.sortOrder = 1;
    const open = createWorkspaceRequirementItem("open");
    open.sortOrder = 2;
    expect(sortWorkspaceRequirementItems([done, open]).map((i) => i.title)).toEqual(["open", "done"]);
  });
});

describe("workspaceRequirementDispatch helpers", () => {
  test("stripMarkdownImages removes image syntax", () => {
    expect(stripMarkdownImages("你好 ![a](data:image/png;base64,abc) 世界")).toBe("你好  世界");
    expect(stripMarkdownImages("见下图\n\n![x](/tmp/a.png)")).toBe("见下图");
  });

  test("extractAbsoluteImagePathsFromMarkdown collects paths", () => {
    expect(
      extractAbsoluteImagePathsFromMarkdown("a ![1](/Users/x/.wise/composer-images/a.png) b ![2](/tmp/b.jpg)"),
    ).toEqual(["/Users/x/.wise/composer-images/a.png", "/tmp/b.jpg"]);
  });

  test("countMarkdownImages counts data and absolute images", () => {
    const md = "t ![a](data:image/png;base64,abc) ![b](/tmp/b.png)";
    expect(countMarkdownImages(md)).toBe(2);
  });
});

describe("prefixExecutionEnvironmentMention", () => {
  test("prefixes current engine mention", () => {
    expect(prefixExecutionEnvironmentMention("做商城", "claude")).toBe("@Claude Code\n做商城");
    expect(prefixExecutionEnvironmentMention("做商城", "codex")).toBe("@Codex CLI\n做商城");
  });

  test("does not double-prefix", () => {
    expect(prefixExecutionEnvironmentMention("@Claude Code\n做商城", "claude")).toBe(
      "@Claude Code\n做商城",
    );
  });
});
