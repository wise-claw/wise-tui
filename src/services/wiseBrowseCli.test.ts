import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWiseBrowseArgv, WISE_BROWSE_HELP, resolveBrowseUrl, summarizeBrowseResult, formatCliOutput } from "../../stagehand-cli/argv.mjs";

describe("wise browse argv", () => {
  test("maps natural-language CLI to sidecar RPC", () => {
    expect(parseWiseBrowseArgv(["browse", "open", "https://www.google.com"])).toEqual({
      kind: "rpc",
      method: "open",
      params: { url: "https://www.google.com", waitUntil: undefined },
      needsSession: true,
    });
    expect(parseWiseBrowseArgv(["act", "click Search"])).toEqual({
      kind: "rpc",
      method: "act",
      params: { instruction: "click Search" },
      needsSession: true,
    });
    expect(parseWiseBrowseArgv(["extract", "page title", "--schema", "{\"type\":\"object\"}"])).toEqual({
      kind: "rpc",
      method: "extract",
      params: { instruction: "page title", schema: { type: "object" } },
      needsSession: true,
    });
    expect(parseWiseBrowseArgv(["fill", "css=input", "hello", "--enter"])).toEqual({
      kind: "rpc",
      method: "fill",
      params: { target: "css=input", value: "hello", pressEnter: true },
      needsSession: true,
    });
    expect(parseWiseBrowseArgv(["mouse", "click", "10", "20"])).toEqual({
      kind: "rpc",
      method: "mouseClick",
      params: { x: 10, y: 20, button: undefined },
      needsSession: true,
    });
    expect(parseWiseBrowseArgv(["tab", "list"])).toMatchObject({ method: "tabList" });
    expect(parseWiseBrowseArgv(["status"])).toMatchObject({ method: "status", needsSession: false });
    expect(parseWiseBrowseArgv(["stop"])).toMatchObject({ method: "stop", needsSession: false });
  });

  test("forwards cloud commands to browse CLI and prints help", () => {
    expect(parseWiseBrowseArgv(["skills", "find", "yelp.com"])).toEqual({
      kind: "browse",
      args: ["skills", "find", "yelp.com"],
    });
    expect(parseWiseBrowseArgv(["help"]).kind).toBe("help");
    expect(parseWiseBrowseArgv([]).kind).toBe("help");
    expect(WISE_BROWSE_HELP).toContain("open <url|站点名>");
    expect(parseWiseBrowseArgv(["nope"]).kind).toBe("error");
  });

  test("resolves Chinese site aliases and implicit session sentences", () => {
    expect(resolveBrowseUrl("谷歌")).toBe("https://www.google.com");
    expect(resolveBrowseUrl("打开谷歌官网")).toBe("https://www.google.com");
    expect(resolveBrowseUrl("github.com")).toBe("https://github.com");
    expect(parseWiseBrowseArgv(["open", "谷歌"])).toMatchObject({
      method: "open",
      params: { url: "https://www.google.com" },
    });
    expect(parseWiseBrowseArgv(["打开谷歌官网"])).toMatchObject({
      method: "open",
      params: { url: "https://www.google.com" },
    });
    expect(parseWiseBrowseArgv(["do", "点击登录"])).toMatchObject({
      method: "act",
      params: { instruction: "点击登录" },
    });
    expect(parseWiseBrowseArgv(["点一下登录"])).toMatchObject({
      method: "act",
      params: { instruction: "点一下登录" },
    });
    expect(summarizeBrowseResult("status", { running: false }, { running: false })).toBe("浏览器未启动");
    expect(formatCliOutput("open", { ok: true }, { url: "https://www.google.com", title: "Google" }).summary).toContain(
      "已打开",
    );
  });

  test("bundled skill tells the session agent to use wise browse", () => {
    const skill = readFileSync(
      path.join(import.meta.dir, "../../src-tauri/resources/skills/wise-browse/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: wise-browse");
    expect(skill).toContain("wise browse open https://www.google.com");
    expect(skill).toContain("打开谷歌官网");
    expect(skill).toContain("configuration only");
  });
});
