import { describe, expect, it } from "bun:test";
import type { GitStatusResponse } from "../types";
import {
  buildConventionalCommitFallback,
  normalizeConventionalCommitMessage,
} from "./conventionalCommitMessage";

describe("conventionalCommitMessage", () => {
  it("normalizes fixed alias to fix with Chinese subject", () => {
    expect(normalizeConventionalCommitMessage("fixed: 阻止文件上传超时")).toBe(
      "fix: 阻止文件上传超时",
    );
  });

  it("keeps single-line Chinese conventional header", () => {
    expect(normalizeConventionalCommitMessage("feat: 新增 Git 分支删除")).toBe(
      "feat: 新增 Git 分支删除",
    );
  });

  it("drops English-only header and mixed body", () => {
    expect(
      normalizeConventionalCommitMessage(
        "feat(gitpanel): add branch delete\n\n涉及文件：src/a.ts\nupdate diffmode",
      ),
    ).toBe("feat: 更新代码变更");
  });

  it("prefixes plain Chinese line with feat", () => {
    expect(normalizeConventionalCommitMessage("阻止文件上传超时")).toBe(
      "feat: 阻止文件上传超时",
    );
  });

  it("builds single-line Chinese fallback from git status", () => {
    const status: GitStatusResponse = {
      branch: "main",
      additions: 3,
      deletions: 1,
      ahead: 0,
      behind: 0,
      upstream: null,
      staged: [{ path: "src/components/GitPanel/DiffMode.tsx", status: "modified", additions: 3, deletions: 1 }],
      unstaged: [],
    };
    const message = buildConventionalCommitFallback(status);
    expect(message.startsWith("feat: 更新Git 面板")).toBe(true);
    expect(message.includes("涉及文件")).toBe(false);
    expect(message.includes("update")).toBe(false);
  });
});
