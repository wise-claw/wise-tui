import { describe, expect, test } from "bun:test";
import {
  STAGEHAND_COMMAND_GROUPS,
  STAGEHAND_COMMANDS,
  STAGEHAND_SURFACES,
  buildBrowseArgv,
  buildSidecarParams,
  commandsForGroup,
  commandsForSurface,
  sanitizeBrowseSessionName,
} from "./stagehandBrowseCatalog";
import {
  collectStagehandEnvVars,
  formatBrowseProbeHint,
  formatStagehandResult,
  parseObserveActions,
  parseStagehandPageStatus,
  splitBrowseRawArgs,
  unwrapBrowseExecResult,
  buildBrowseReadiness,
  parseStagehandBrowseLatestReport,
  formatBrowseInstallSummary,
} from "./stagehandBrowse";

describe("stagehand browse catalog", () => {
  test("covers every Stagehand CLI / SDK capability group", () => {
    const ids = STAGEHAND_COMMAND_GROUPS.map((group) => group.id);
    expect(ids).toEqual([
      "session",
      "navigate",
      "ai",
      "element",
      "mouse",
      "page",
      "wait",
      "tabs",
      "clipboard",
      "webmcp",
      "network",
      "cloud",
      "skills",
      "functions",
      "templates",
    ]);
    for (const group of ids) {
      expect(commandsForGroup(group).length).toBeGreaterThan(0);
    }
  });

  test("includes Stagehand AI primitives and browse cloud/skills", () => {
    const commandIds = STAGEHAND_COMMANDS.map((item) => item.id);
    for (const id of [
      "act",
      "extract",
      "observe",
      "agent",
      "snapshot",
      "webmcp.list",
      "webmcp.invoke",
      "clipboard.read",
      "cloud.fetch",
      "cloud.extensions.upload",
      "skills.list",
      "functions.dev",
      "functions.invoke",
      "templates.clone",
      "cdp",
    ]) {
      expect(commandIds).toContain(id);
    }
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });

  test("builds sidecar params and browse argv", () => {
    const act = STAGEHAND_COMMANDS.find((item) => item.id === "act");
    expect(act).toBeTruthy();
    expect(
      buildSidecarParams(act!, { instruction: "click the login button" }),
    ).toEqual({ instruction: "click the login button" });
    expect(() => buildSidecarParams(act!, { instruction: "" })).toThrow("指令 不能为空");
    const mouse = STAGEHAND_COMMANDS.find((item) => item.id === "mouse.click");
    expect(mouse).toBeTruthy();
    expect(buildBrowseArgv(mouse!, { x: 240, y: 320 }, "wise-1")).toEqual([
      "mouse",
      "click",
      "240",
      "320",
    ]);

    const skills = STAGEHAND_COMMANDS.find((item) => item.id === "skills.find");
    expect(skills).toBeTruthy();
    expect(buildBrowseArgv(skills!, { query: "yelp.com" }, "wise-1")).toEqual([
      "skills",
      "find",
      "yelp.com",
    ]);
  });

  test("sanitizes session names and formats results", () => {
    expect(sanitizeBrowseSessionName("abc/def")).toBe("wise-abc_def");
    expect(formatStagehandResult({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(collectStagehandEnvVars({ browserbaseApiKey: " bb_live " })).toEqual({
      BROWSERBASE_API_KEY: "bb_live",
    });
  });

  test("maps commands onto four product surfaces", () => {
    const surfaced = new Set(STAGEHAND_SURFACES.flatMap((surface) => commandsForSurface(surface.id).map((item) => item.id)));
    const leftover = STAGEHAND_COMMANDS.filter((item) => item.group !== "session" && !surfaced.has(item.id));
    expect(leftover).toEqual([]);
    expect(commandsForSurface("ai").some((item) => item.id === "act")).toBe(true);
  });

  test("parses page status, observe actions, raw CLI, and browse failures", () => {
    expect(parseStagehandPageStatus({ running: true, url: "https://a.dev", title: "A", pageCount: 2 })).toEqual({
      running: true,
      url: "https://a.dev",
      title: "A",
      pageCount: 2,
      authSummary: null,
      cookieCount: 0,
    });
    expect(
      parseStagehandPageStatus({
        running: true,
        url: "https://a.dev",
        title: "A",
        pageCount: 1,
        auth: { summary: "已记住登录态 · default · 3 个 Cookie", cookieCount: 3 },
      }),
    ).toMatchObject({
      authSummary: "已记住登录态 · default · 3 个 Cookie",
      cookieCount: 3,
    });
    const actions = parseObserveActions({
      data: [{ description: "click login", selector: "#login", method: "click" }],
    });
    expect(actions[0]?.description).toBe("click login");
    expect(splitBrowseRawArgs(`skills find "yelp.com/reviews"`)).toEqual(["skills", "find", "yelp.com/reviews"]);
    expect(() =>
      unwrapBrowseExecResult({ ok: false, stdout: "", stderr: "not found", exitCode: 1 }),
    ).toThrow("not found");
    expect(formatBrowseProbeHint(null)).toContain("检测");
    expect(
      formatBrowseProbeHint({
        browseAvailable: false,
        browseBinary: null,
        browseVersion: null,
        sidecarAvailable: true,
        sidecarDir: "/tmp",
        sidecarReady: true,
        runtime: "bun",
        hasBrowserbaseKey: false,
        cliAvailable: true,
        cliBinary: "/tmp/wise-browse",
        skillInstalled: true,
        configPath: "/tmp/config.json",
        error: null,
      }),
    ).toContain("打开谷歌官网");
    expect(
      buildBrowseReadiness({
        browseAvailable: false,
        browseBinary: null,
        browseVersion: null,
        sidecarAvailable: true,
        sidecarDir: "/tmp",
        sidecarReady: true,
        runtime: "bun",
        hasBrowserbaseKey: false,
        cliAvailable: true,
        cliBinary: "/tmp/wise-browse",
        skillInstalled: false,
        configPath: "/tmp/config.json",
        error: null,
      }).map((item) => [item.id, item.ok]),
    ).toEqual([
      ["runtime", true],
      ["cli", true],
      ["skill", false],
    ]);
    expect(
      parseStagehandBrowseLatestReport({
        found: true,
        kind: "acceptance",
        name: "登录页验收",
        passed: false,
        summary: "未通过：失败 1，通过 2，共 3",
        at: "2026-08-26T00:00:00.000Z",
        counts: { passed: 2, failed: 1, skipped: 0, total: 3 },
        durationMs: 1200,
        jsonPath: "/tmp/a.json",
        markdownPath: "/tmp/a.md",
      }),
    ).toMatchObject({
      found: true,
      passed: false,
      name: "登录页验收",
      durationMs: 1200,
      markdownPath: "/tmp/a.md",
    });
    expect(parseStagehandBrowseLatestReport(null).found).toBe(false);
    expect(
      formatBrowseInstallSummary({
        ok: true,
        stdout: "已同步脚本 → /tmp\n已写入 CLI → /tmp/wise-browse\n已挂载会话 Skill（Claude / Codex / agents）\n",
        stderr: "",
        exitCode: 0,
        shimPath: "/tmp/wise-browse",
        skillInstalled: true,
        pathStatus: "added",
      }),
    ).toContain("已写入 CLI");
  });
});
