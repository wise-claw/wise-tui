import { describe, expect, test } from "bun:test";
import {
  buildPageMonitorAutoFixPrompt,
  formatChromeDevtoolsIssueLine,
  isPageMonitorDiagnosticKind,
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

  test("formats page crash as error", () => {
    const line = formatChromeDevtoolsIssueLine(
      issue({ kind: "page-crash", message: "main frame crashed" }),
    );
    expect(line).toContain("Chrome page crash");
    expect(detectRunLogIssue(line)?.kind).toBe("error");
  });

  test("formats Web Vitals diagnostics", () => {
    const lcp = formatChromeDevtoolsIssueLine(
      issue({ kind: "page-vitals", message: "LCP 2500ms", metric: "lcp", value: 2500 }),
    );
    expect(lcp).toBe("Chrome vitals LCP: 2500ms");
    expect(detectRunLogIssue(lcp)).toBeNull();

    const cls = formatChromeDevtoolsIssueLine(
      issue({ kind: "page-vitals", message: "CLS 0.123", metric: "cls", value: 0.123 }),
    );
    expect(cls).toBe("Chrome vitals CLS: 0.123");
  });

  test("formats long task and slow request", () => {
    const longTask = formatChromeDevtoolsIssueLine(
      issue({ kind: "long-task", message: "812ms main-thread block", value: 812, durationMs: 812 }),
    );
    expect(longTask).toBe("Chrome long task: 812ms");
    expect(detectRunLogIssue(longTask)).toBeNull();

    const slow = formatChromeDevtoolsIssueLine(
      issue({
        kind: "slow-request",
        message: "GET http://localhost:3000/api/x 200 in 5120ms",
        url: "http://localhost:3000/api/x",
        method: "GET",
        status: 200,
        durationMs: 5120,
      }),
    );
    expect(slow).toBe("GET http://localhost:3000/api/x 200 in 5120ms");
  });

  test("tags non-API resource types on network issues", () => {
    const img = formatChromeDevtoolsIssueLine(
      issue({
        kind: "network-http",
        message: "GET https://cdn/x.png 404",
        url: "https://cdn/x.png",
        method: "GET",
        status: 404,
        resourceType: "Image",
      }),
    );
    expect(img).toBe("[Image] GET https://cdn/x.png 404");
    expect(detectRunLogIssue(img)?.kind).toBe("http");

    const api = formatChromeDevtoolsIssueLine(
      issue({
        kind: "network-http",
        message: "GET http://localhost:3000/api/x 500",
        url: "http://localhost:3000/api/x",
        method: "GET",
        status: 500,
        resourceType: "Fetch",
      }),
    );
    expect(api).toBe("GET http://localhost:3000/api/x 500");
  });
});

describe("isPageMonitorDiagnosticKind", () => {
  test("marks performance diagnostics", () => {
    expect(isPageMonitorDiagnosticKind("page-vitals")).toBe(true);
    expect(isPageMonitorDiagnosticKind("long-task")).toBe(true);
    expect(isPageMonitorDiagnosticKind("slow-request")).toBe(true);
    expect(isPageMonitorDiagnosticKind("SLOW-REQUEST")).toBe(true);
    expect(isPageMonitorDiagnosticKind("page-error")).toBe(false);
    expect(isPageMonitorDiagnosticKind("page-crash")).toBe(false);
    expect(isPageMonitorDiagnosticKind(null)).toBe(false);
    expect(isPageMonitorDiagnosticKind(undefined)).toBe(false);
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
