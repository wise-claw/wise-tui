import { describe, expect, test } from "bun:test";
import {
  buildPageMonitorAutoFixPrompt,
  formatChromeDevtoolsIssueLine,
  isPageMonitorIgnorableNoise,
  normalizePageMonitorChromeMode,
  normalizePageMonitorDebugPort,
  type ChromeDevtoolsIssue,
} from "./chromeDevtoolsMonitor";
import { detectRunLogIssue } from "../utils/repositoryRunCommand";

function issue(partial: Partial<ChromeDevtoolsIssue> & Pick<ChromeDevtoolsIssue, "kind" | "message">): ChromeDevtoolsIssue {
  return { sessionId: "1", ...partial };
}

describe("formatChromeDevtoolsIssueLine", () => {
  test("formats page and console errors for AI monitor", () => {
    const page = formatChromeDevtoolsIssueLine(
      issue({ kind: "page-error", message: "TypeError: x is not a function" }),
    );
    expect(page).toContain("Chrome page error");
    expect(detectRunLogIssue(page)?.kind).toBe("error");

    const consoleErr = formatChromeDevtoolsIssueLine(
      issue({ kind: "console-error", message: "Uncaught ReferenceError: foo" }),
    );
    expect(detectRunLogIssue(consoleErr)?.kind).toBe("error");
  });

  test("formats console warnings", () => {
    const line = formatChromeDevtoolsIssueLine(
      issue({ kind: "console-warning", message: "deprecated API" }),
    );
    expect(detectRunLogIssue(line)?.kind).toBe("warning");
  });

  test("formats HTTP 4xx/5xx as request failures", () => {
    const line = formatChromeDevtoolsIssueLine(
      issue({
        kind: "network-http",
        message: "GET http://localhost:3000/api/x 500",
        method: "GET",
        url: "http://localhost:3000/api/x",
        status: 500,
      }),
    );
    expect(line).toBe("GET http://localhost:3000/api/x 500");
    expect(detectRunLogIssue(line)?.kind).toBe("http");
  });

  test("formats network failed", () => {
    const line = formatChromeDevtoolsIssueLine(
      issue({
        kind: "network-failed",
        message: "net::ERR_CONNECTION_REFUSED",
        url: "http://localhost:3000/api",
      }),
    );
    expect(line).toContain("failed");
    expect(detectRunLogIssue(line)?.kind).toBe("http");
  });
});

describe("buildPageMonitorAutoFixPrompt", () => {
  test("includes monitor url and issue summary", () => {
    const prompt = buildPageMonitorAutoFixPrompt({
      url: "http://localhost:5173",
      issuesText: "Chrome page error: TypeError: boom\nGET http://localhost:5173/api/x 500\n",
    });
    expect(prompt).toContain("浏览器页面监控");
    expect(prompt).toContain("http://localhost:5173");
    expect(prompt).toContain("接口");
    expect(prompt).toContain("错误");
  });
});

describe("normalizePageMonitorChromeMode / debugPort", () => {
  test("normalizes mode aliases", () => {
    expect(normalizePageMonitorChromeMode("attach")).toBe("attach");
    expect(normalizePageMonitorChromeMode("existing")).toBe("attach");
    expect(normalizePageMonitorChromeMode("extension")).toBe("extension");
    expect(normalizePageMonitorChromeMode("ext")).toBe("extension");
    expect(normalizePageMonitorChromeMode("plugin")).toBe("extension");
    expect(normalizePageMonitorChromeMode("launch")).toBe("launch");
    expect(normalizePageMonitorChromeMode("")).toBe("launch");
  });

  test("clamps debug port", () => {
    expect(normalizePageMonitorDebugPort(9222)).toBe(9222);
    expect(normalizePageMonitorDebugPort("9222")).toBe(9222);
    expect(normalizePageMonitorDebugPort(0)).toBe(9222);
    expect(normalizePageMonitorDebugPort(99999)).toBe(9222);
  });
});

describe("isPageMonitorIgnorableNoise", () => {
  test("ignores HMR / Fast Refresh noise", () => {
    expect(isPageMonitorIgnorableNoise("[vite] hot updated /src/app/layout.tsx")).toBe(true);
    expect(isPageMonitorIgnorableNoise("Fast Refresh had to perform a full reload")).toBe(true);
    expect(isPageMonitorIgnorableNoise("[HMR] connected")).toBe(true);
    expect(isPageMonitorIgnorableNoise("webpack-hmr disconnected")).toBe(true);
    expect(
      isPageMonitorIgnorableNoise("Uncaught (in promise): Event at http://localhost:3000/:0"),
    ).toBe(true);
  });

  test("keeps real compile / runtime errors", () => {
    expect(
      isPageMonitorIgnorableNoise(
        "Chrome console error: ./src/app/layout.tsx Error: x Expression expected",
      ),
    ).toBe(false);
    expect(isPageMonitorIgnorableNoise("GET http://localhost:3000/api/x 500")).toBe(false);
  });
});
