import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWiseBrowseArgv, WISE_BROWSE_HELP, resolveBrowseUrl, summarizeBrowseResult, formatCliOutput } from "../../stagehand-cli/argv.mjs";
import {
  evaluateCompare,
  evaluateState,
  parseAssertSpec,
  parseAssertPhrase,
  parseSuiteDocument,
  suiteFromChecks,
  buildSuiteReport,
  formatMarkdownReport,
  summarizeLatestPointer,
  interpretExpectPayload,
  DEFAULT_ACCEPT_SUITE,
} from "../../stagehand-cli/assert.mjs";

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
    expect(skill).toContain("wise browse assert title contains Google");
    expect(skill).toContain("wise browse accept --file");
    expect(skill).toContain("wise browse accept --init");
    expect(skill).toContain("wise browse report");
    expect(skill).toContain("Automated testing");
    expect(skill).toContain("Automated acceptance");
    expect(skill).toContain("一键安装");
  });
});

describe("wise browse assert and acceptance", () => {
  test("evaluates compare and visibility assertions", () => {
    expect(evaluateCompare("Google Search", "contains", "Google").passed).toBe(true);
    expect(evaluateCompare("Google Search", "包含", "Bing").passed).toBe(false);
    expect(evaluateCompare("https://example.com/login", "matches", "/login$").passed).toBe(true);
    expect(evaluateState({ state: "visible", actual: true }).passed).toBe(true);
    expect(evaluateState({ state: "hidden", actual: true }).passed).toBe(false);
    expect(parseAssertSpec(["title", "contains", "Google"])).toEqual({
      kind: "compare",
      field: "title",
      op: "contains",
      value: "Google",
      target: undefined,
    });
    expect(parseAssertSpec(["visible", "css=button.submit"])).toEqual({
      kind: "state",
      state: "visible",
      target: "css=button.submit",
    });
    expect(parseAssertPhrase("标题包含 登录")).toMatchObject({
      kind: "compare",
      field: "title",
      op: "contains",
      value: "登录",
    });
    expect(parseAssertPhrase("标题应该包含 Google")).toMatchObject({
      field: "title",
      op: "contains",
      value: "Google",
    });
    expect(parseAssertPhrase("标题不能包含 Error")).toMatchObject({
      field: "title",
      op: "not_contains",
      value: "Error",
    });
    expect(parseAssertPhrase("应该可见 css=button.submit")).toMatchObject({
      kind: "state",
      state: "visible",
      target: "css=button.submit",
    });
  });

  test("parses CLI assert / expect / accept suites", () => {
    expect(parseWiseBrowseArgv(["assert", "title", "contains", "Google"])).toMatchObject({
      kind: "rpc",
      method: "assert",
      params: { kind: "compare", field: "title", op: "contains", value: "Google" },
    });
    expect(parseWiseBrowseArgv(["assert", "visible", "css=input[name=q]"])).toMatchObject({
      method: "assert",
      params: { kind: "state", state: "visible", target: "css=input[name=q]" },
    });
    expect(parseWiseBrowseArgv(["expect", "页面有登录按钮"])).toMatchObject({
      method: "expect",
      params: { instruction: "页面有登录按钮" },
    });
    expect(parseWiseBrowseArgv(["断言标题包含 Google"])).toMatchObject({
      method: "assert",
      params: { field: "title", op: "contains", value: "Google" },
    });
    expect(parseWiseBrowseArgv(["验收当前页有登录按钮"])).toMatchObject({
      method: "expect",
      params: { instruction: "当前页有登录按钮" },
    });
    expect(parseWiseBrowseArgv(["标题应该包含 Google"])).toMatchObject({
      method: "assert",
      params: { field: "title", op: "contains", value: "Google" },
    });
    expect(parseWiseBrowseArgv(["查看最近验收报告"])).toEqual({ kind: "report", action: "latest" });
    expect(parseWiseBrowseArgv(["report", "list"])).toEqual({ kind: "report", action: "list" });
    expect(parseWiseBrowseArgv(["accept", "--init", "login.accept.json"])).toMatchObject({
      kind: "init",
      file: "login.accept.json",
    });
    expect(parseWiseBrowseArgv(["初始化验收套件"])).toMatchObject({
      kind: "init",
      file: "login.accept.json",
    });
    const suite = parseWiseBrowseArgv([
      "accept",
      "--url",
      "https://example.com/login",
      "--check",
      "title contains 登录",
      "--check",
      "visible css=button[type=submit]",
    ]);
    expect(suite.kind).toBe("suite");
    expect(suite.suiteKind).toBe("accept");
    expect(suite.suite.steps.some((step) => step.action === "open")).toBe(true);
    expect(suite.suite.steps.some((step) => step.action === "assert")).toBe(true);
  });

  test("builds pass/fail acceptance reports and interprets expect payloads", () => {
    const parsed = parseSuiteDocument({
      name: "登录页验收",
      url: "https://example.com/login",
      steps: [
        { assert: "title contains 登录" },
        { visible: "css=button[type=submit]" },
        { expect: "页面有密码框" },
      ],
    });
    expect(parsed.steps[0].action).toBe("open");
    expect(parsed.steps[1].action).toBe("assert");
    const report = buildSuiteReport({
      kind: "accept",
      name: parsed.name,
      results: [
        { passed: true, label: "title contains 登录" },
        { passed: false, label: "visible css=button", message: "失败：visible" },
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.counts.failed).toBe(1);
    expect(report.summary).toContain("未通过");
    expect(interpretExpectPayload({ passed: true, reason: "看到登录按钮" }).passed).toBe(true);
    expect(interpretExpectPayload("fail").passed).toBe(false);
    expect(
      suiteFromChecks({
        url: "https://example.com",
        checks: ["title contains Example"],
      }).steps.length,
    ).toBeGreaterThan(1);
    expect(WISE_BROWSE_HELP).toContain("assert title contains");
    expect(WISE_BROWSE_HELP).toContain("accept --init");
    expect(WISE_BROWSE_HELP).toContain("report [latest|list]");
    expect(summarizeBrowseResult("assert", { passed: false, message: "失败：contains" })).toContain("失败");
    expect(summarizeBrowseResult("report", { found: false })).toBe("还没有验收报告");
    expect(formatCliOutput("accept", report).passed).toBe(false);
  });

  test("parses wait/screenshot/soft suite steps and formats markdown reports", () => {
    const parsed = parseSuiteDocument({
      name: "登录页验收",
      retries: 1,
      steps: [
        { wait: { selector: "css=form", timeout: 2000 } },
        { screenshot: true },
        { assert: "title contains 登录", soft: true },
      ],
    });
    expect(parsed.retries).toBe(1);
    expect(parsed.steps.map((step) => step.action)).toEqual(["wait", "screenshot", "assert"]);
    expect(parsed.steps[0]).toMatchObject({ target: "css=form", ms: 2000 });
    expect(parsed.steps[2].soft).toBe(true);
    const template = parseSuiteDocument(DEFAULT_ACCEPT_SUITE);
    expect(template.steps.some((step) => step.action === "wait")).toBe(true);
    expect(template.steps.some((step) => step.action === "screenshot")).toBe(true);
    const report = buildSuiteReport({
      kind: "accept",
      name: "登录页验收",
      results: [
        { passed: true, label: "打开页面", durationMs: 12 },
        { passed: false, label: "visible css=button", message: "失败：visible", soft: true, durationMs: 40 },
      ],
    });
    const markdown = formatMarkdownReport(report);
    expect(markdown).toContain("验收报告：登录页验收");
    expect(markdown).toContain("未通过");
    expect(markdown).toContain("⚠");
    expect(markdown).toContain("12ms");
    const pointer = summarizeLatestPointer({ ...report, reportPath: "/tmp/a.json", markdownPath: "/tmp/a.md" });
    expect(pointer.jsonPath).toBe("/tmp/a.json");
    expect(pointer.markdownPath).toBe("/tmp/a.md");
    expect(pointer.passed).toBe(false);
  });
});
