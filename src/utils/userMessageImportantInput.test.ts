import { describe, expect, test } from "bun:test";
import { extractImportantUserInputForDisplay } from "./userMessageImportantInput";

describe("extractImportantUserInputForDisplay", () => {
  test("extracts Cursor user_query and drops injected blocks", () => {
    const full = [
      "[Image]",
      "<image_files>",
      "The following images were provided",
      "</image_files>",
      "<user_rules>Always respond in 中文</user_rules>",
      "<user_query>",
      "会话消息列表支持向 cursor 一样展示只重要输入信息",
      "</user_query>",
    ].join("\n");
    const out = extractImportantUserInputForDisplay(full);
    expect(out.compactText).toBe("会话消息列表支持向 cursor 一样展示只重要输入信息");
    expect(out.hasStrippedContext).toBe(true);
  });

  test("strips Claude command blocks without user_query", () => {
    const full = [
      "<command-name>/help</command-name>",
      "<command-message>help</command-message>",
      "实际用户提问",
    ].join("\n");
    const out = extractImportantUserInputForDisplay(full);
    expect(out.compactText).toBe("实际用户提问");
    expect(out.hasStrippedContext).toBe(true);
  });

  test("extracts command-args from oh-my-claudecode autopilot envelope", () => {
    const full = [
      "<command-message>oh-my-claudecode:autopilot</command-message>",
      "<command-name>/oh-my-claudecode:autopilot</command-name>",
      "<command-args>你好</command-args>",
    ].join(" ");
    const out = extractImportantUserInputForDisplay(full);
    expect(out.compactText).toBe("你好");
    expect(out.hasStrippedContext).toBe(true);
  });

  test("removes 附图 suffix and records attachment paths", () => {
    const path = "/Users/sjl/.wise/composer-images/wise/demo.png";
    const full = `你好\n\n附图：@${path}`;
    const out = extractImportantUserInputForDisplay(full);
    expect(out.compactText).toBe("你好");
    expect(out.attachmentPaths).toEqual([path]);
    expect(out.hasStrippedContext).toBe(true);
  });

  test("plain prompt stays unchanged", () => {
    const full = "请帮我重构 useClaudeSessions";
    const out = extractImportantUserInputForDisplay(full);
    expect(out.compactText).toBe(full);
    expect(out.hasStrippedContext).toBe(false);
    expect(out.attachmentPaths).toEqual([]);
  });
});
