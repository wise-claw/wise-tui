import { describe, expect, test } from "bun:test";
import {
  buildRunErrorAutoFixPrompt,
  buildRunErrorFingerprint,
  collectRunLogIssues,
  decideRunErrorMonitorStep,
  detectRunLogIssue,
  isSameRunErrorFingerprint,
  lineHasRunLogIssue,
  summarizeRunLogIssueKinds,
} from "./repositoryRunCommand";

describe("detectRunLogIssue", () => {
  test("detects runtime errors and exceptions", () => {
    expect(detectRunLogIssue("ERROR Failed to connect to db")?.kind).toBe("error");
    expect(detectRunLogIssue("TypeError: Cannot read properties of undefined")?.kind).toBe("error");
    expect(detectRunLogIssue("\u2A2F Error: Module not found")?.kind).toBe("error");
    expect(detectRunLogIssue("npm ERR! code ELIFECYCLE")?.kind).toBe("error");
    expect(detectRunLogIssue("\u7F16\u8BD1\u5931\u8D25: cannot find name")?.kind).toBe("error");
  });

  test("detects warnings and alerts", () => {
    expect(detectRunLogIssue("warn: Fast Refresh had to perform a full reload")?.kind).toBe(
      "warning",
    );
    expect(detectRunLogIssue("\u26A0 Warning: Extra attributes from the server")?.kind).toBe(
      "warning",
    );
    expect(detectRunLogIssue("DEPRECATED: useNewApi is deprecated")?.kind).toBe("warning");
    expect(detectRunLogIssue("\u544A\u8B66\uFF1A\u5185\u5B58\u5360\u7528\u8FC7\u9AD8")?.kind).toBe(
      "warning",
    );
  });

  test("detects HTTP and API request failures", () => {
    expect(detectRunLogIssue("GET /api/users 500")?.kind).toBe("http");
    expect(detectRunLogIssue("POST /auth/signin 404 in 12ms")?.kind).toBe("http");
    expect(detectRunLogIssue("HTTP 502 Bad Gateway")?.kind).toBe("http");
    expect(detectRunLogIssue("fetch failed: statusCode: 503")?.kind).toBe("http");
    expect(detectRunLogIssue("connect ECONNREFUSED 127.0.0.1:5432")?.kind).toBe("http");
    expect(
      detectRunLogIssue("\u63A5\u53E3\u8BF7\u6C42\u5931\u8D25\uFF1Atimeout")?.kind,
    ).toBe("http");
  });

  test("ignores successful requests and normal logs", () => {
    expect(detectRunLogIssue("GET /auth/signin?callbackUrl=http://localhost:3000")).toBeNull();
    expect(detectRunLogIssue("GET /api/users 200 in 12ms")).toBeNull();
    expect(detectRunLogIssue("\u2713 Compiled in 39ms (253 modules)")).toBeNull();
    expect(detectRunLogIssue("all good here")).toBeNull();
  });

  test("does not false-positive on successful paths containing error", () => {
    expect(detectRunLogIssue("GET /auth/error 200")).toBeNull();
    expect(detectRunLogIssue("GET /auth/error 500")?.kind).toBe("http");
  });
});

describe("collectRunLogIssues / summarize", () => {
  test("collects mixed kinds in order without duplicates", () => {
    const issues = collectRunLogIssues(
      [
        "warn: something odd",
        "GET /api/x 500",
        "ERROR boom",
        "GET /api/x 500",
        "ok line",
      ].join("\n"),
    );
    expect(issues.map((i) => i.kind)).toEqual(["warning", "http", "error"]);
    expect(summarizeRunLogIssueKinds(issues)).toBe(
      "\u9519\u8BEF\u3001\u544A\u8B66\u3001\u63A5\u53E3\u8BF7\u6C42\u9519\u8BEF",
    );
  });
});

describe("buildRunErrorAutoFixPrompt", () => {
  test("includes issue kinds and hit summary", () => {
    const prompt = buildRunErrorAutoFixPrompt({
      command: "npm run dev",
      tailText: "WARN deprecated api\nGET /api/feed 500\nERROR render failed",
    });
    expect(prompt).toContain(
      "\u95EE\u9898\u7C7B\u578B\uFF1A\u9519\u8BEF\u3001\u544A\u8B66\u3001\u63A5\u53E3\u8BF7\u6C42\u9519\u8BEF",
    );
    expect(prompt).toContain("[\u544A\u8B66]");
    expect(prompt).toContain("[\u63A5\u53E3]");
    expect(prompt).toContain("[\u9519\u8BEF]");
    expect(prompt).toContain("npm run dev");
  });
});

describe("buildRunErrorFingerprint", () => {
  test("same error with different timestamps normalizes to one fingerprint", () => {
    const a = "2024-01-01 10:00:01 ERROR Failed to connect to db at line 42";
    const b = "2024-01-01 10:00:09 ERROR Failed to connect to db at line 42";
    expect(buildRunErrorFingerprint(a)).toBe(buildRunErrorFingerprint(b));
  });

  test("retry counters and ports still normalize", () => {
    const a = "retry 1/5: error connection refused on port 5432";
    const b = "retry 4/5: error connection refused on port 5432";
    expect(buildRunErrorFingerprint(a)).toBe(buildRunErrorFingerprint(b));
  });

  test("different errors produce different fingerprints", () => {
    const a = "ERROR Failed to connect to db";
    const b = "ERROR Port 8080 already in use";
    expect(buildRunErrorFingerprint(a)).not.toBe(buildRunErrorFingerprint(b));
  });

  test("ANSI sequences normalize to plain text", () => {
    const withAnsi = "\u001b[31mERROR\u001b[0m something failed";
    const plain = "ERROR something failed";
    expect(buildRunErrorFingerprint(withAnsi)).toBe(buildRunErrorFingerprint(plain));
  });

  test("multi-line errors merge in order", () => {
    const fp = buildRunErrorFingerprint("ERROR line one\nINFO ok\nERROR line two");
    expect(fp).toBe("error line one | error line two");
  });

  test("HTTP failures enter fingerprint; successes do not", () => {
    const fp = buildRunErrorFingerprint("GET /ok 200\nGET /api/x 500\nCompiled ok");
    expect(fp).toContain("get /api/x n");
    expect(fp).not.toContain("get /ok");
  });

  test("logs without issue keywords return empty fingerprint", () => {
    expect(buildRunErrorFingerprint("all good here\nstarting up")).toBe("");
  });
});

describe("isSameRunErrorFingerprint", () => {
  test("empty values are never the same", () => {
    expect(isSameRunErrorFingerprint(null, "x")).toBe(false);
    expect(isSameRunErrorFingerprint("", "x")).toBe(false);
    expect(isSameRunErrorFingerprint("x", "")).toBe(false);
  });

  test("equal fingerprints match", () => {
    expect(isSameRunErrorFingerprint("fp", "fp")).toBe(true);
    expect(isSameRunErrorFingerprint("a", "b")).toBe(false);
  });
});

describe("decideRunErrorMonitorStep", () => {
  test("arms first dispatch when not yet sent", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: false,
        dispatchedFingerprint: null,
        fingerprint: "fp",
        loopCount: 0,
      }),
    ).toEqual({ action: "arm-dispatch" });
  });

  test("matching fingerprint after dispatch reports loop", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "fp",
        loopCount: 1,
      }),
    ).toEqual({ action: "report-loop", loopCount: 2 });
  });

  test("different fingerprint after dispatch reports new issue", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "other",
        loopCount: 3,
      }),
    ).toEqual({ action: "report-new-after-dispatch" });
  });

  test("null dispatched fingerprint is not treated as loop", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: null,
        fingerprint: "fp",
        loopCount: 0,
      }),
    ).toEqual({ action: "report-new-after-dispatch" });
  });
});

describe("lineHasRunLogIssue", () => {
  test("matches detectRunLogIssue presence", () => {
    expect(lineHasRunLogIssue("ERROR x")).toBe(true);
    expect(lineHasRunLogIssue("GET / 200")).toBe(false);
  });
});
