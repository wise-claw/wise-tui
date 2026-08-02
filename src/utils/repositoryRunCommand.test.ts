import { describe, expect, test } from "bun:test";
import {
  buildRunErrorAutoFixPrompt,
  buildRunErrorFingerprint,
  collectRunLogIssues,
  decideRunErrorMonitorStep,
  detectRunLogIssue,
  isRunLogIgnorableNoise,
  isSameRunErrorFingerprint,
  lineHasRunLogIssue,
  normalizeRunLogOutputChunk,
  parseRunRestart,
  summarizeRunLogIssueKinds,
  wrapCommandWithAutoRestart,
} from "./repositoryRunCommand";

describe("normalizeRunLogOutputChunk", () => {
  test("keeps only the last CR-overwritten segment on a line", () => {
    expect(normalizeRunLogOutputChunk("progress 10%\rprogress 20%\rprogress 100%\n")).toBe(
      "progress 100%\n",
    );
  });

  test("preserves CRLF as newline without inventing extra lines", () => {
    expect(normalizeRunLogOutputChunk("a\r\nb\r\n")).toBe("a\nb\n");
  });

  test("strips ansi sequences", () => {
    expect(normalizeRunLogOutputChunk("\u001b[31mred\u001b[0m\n")).toBe("red\n");
  });
});

describe("detectRunLogIssue", () => {
  test("detects runtime errors and exceptions", () => {
    expect(detectRunLogIssue("ERROR Failed to connect to db")?.kind).toBe("error");
    expect(detectRunLogIssue("TypeError: Cannot read properties of undefined")?.kind).toBe("error");
    expect(detectRunLogIssue("\u2A2F Error: Module not found")?.kind).toBe("error");
    expect(detectRunLogIssue("npm ERR! code ELIFECYCLE")?.kind).toBe("error");
    expect(detectRunLogIssue("\u7F16\u8BD1\u5931\u8D25: cannot find name")?.kind).toBe("error");
  });

  test("detects warnings and alerts", () => {
    expect(detectRunLogIssue("warn: something odd")?.kind).toBe("warning");
    expect(detectRunLogIssue("\u26A0 Warning: Extra attributes from the server")?.kind).toBe(
      "warning",
    );
    expect(detectRunLogIssue("DEPRECATED: useNewApi is deprecated")?.kind).toBe("warning");
    expect(detectRunLogIssue("\u544A\u8B66\uFF1A\u5185\u5B58\u5360\u7528\u8FC7\u9AD8")?.kind).toBe(
      "warning",
    );
    // Fast Refresh / HMR ????????
    expect(detectRunLogIssue("warn: Fast Refresh had to perform a full reload")).toBeNull();
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
    expect(detectRunLogIssue("[vite] hot updated /src/app/page.tsx")).toBeNull();
    expect(detectRunLogIssue("Fast Refresh had to perform a full reload")).toBeNull();
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

  test("continuous mode re-arms on different fingerprint after dispatch", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "other",
        loopCount: 1,
        continuous: true,
      }),
    ).toEqual({ action: "arm-dispatch" });
  });

  test("continuous mode still reports loop on same fingerprint", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "fp",
        loopCount: 2,
        continuous: true,
      }),
    ).toEqual({ action: "report-loop", loopCount: 3 });
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
    expect(lineHasRunLogIssue("Fast Refresh had to perform a full reload")).toBe(false);
  });
});

describe("isRunLogIgnorableNoise", () => {
  test("filters HMR and compile chatter", () => {
    expect(isRunLogIgnorableNoise("[vite] hot updated /src/app/layout.tsx")).toBe(true);
    expect(isRunLogIgnorableNoise("Fast Refresh had to perform a full reload")).toBe(true);
    expect(isRunLogIgnorableNoise("Compiled in 39ms (253 modules)")).toBe(true);
    expect(isRunLogIgnorableNoise("TypeError: boom")).toBe(false);
  });
});

describe("wrapCommandWithAutoRestart", () => {
  test("empty command passes through untouched", () => {
    expect(wrapCommandWithAutoRestart("   ", 5)).toBe("");
    expect(wrapCommandWithAutoRestart("", 5)).toBe("");
  });

  test("invalid interval passes through untouched", () => {
    expect(wrapCommandWithAutoRestart("bun run dev", 0)).toBe("bun run dev");
    expect(wrapCommandWithAutoRestart("bun run dev", -1)).toBe("bun run dev");
    expect(wrapCommandWithAutoRestart("bun run dev", 3601)).toBe("bun run dev");
    expect(wrapCommandWithAutoRestart("bun run dev", 99999)).toBe("bun run dev");
    expect(wrapCommandWithAutoRestart("bun run dev", Number.NaN)).toBe("bun run dev");
  });

  test("wraps command in a restart loop with sleep interval", () => {
    const wrapped = wrapCommandWithAutoRestart("bun run dev", 5);
    expect(wrapped).toContain("while true; do");
    expect(wrapped).toContain("  bun run dev");
    expect(wrapped).toContain('  if [ "$code" -ne 0 ] && [ "$code" -ne 130 ]; then');
    expect(wrapped).toContain("    sleep 5");
    expect(wrapped).toContain("    break");
    expect(wrapped).toContain("done");
    expect(wrapped).toMatch(/5 秒后自动重启/);
  });

  test("multiline output has the exact canonical structure", () => {
    expect(wrapCommandWithAutoRestart("bun run dev", 5)).toBe(
      [
        "while true; do",
        "  bun run dev",
        "  code=$?",
        '  if [ "$code" -ne 0 ] && [ "$code" -ne 130 ]; then',
        '    echo ""',
        '    echo "[wise] 命令已退出（码 $code），5 秒后自动重启… 按 Ctrl+C 停止"',
        "    sleep 5",
        "  else",
        '    echo ""',
        '    echo "[wise] 命令已停止（码 $code），不再重启"',
        "    break",
        "  fi",
        "done",
      ].join("\n"),
    );
  });

  test("multi-line command keeps its lines inside the loop", () => {
    const wrapped = wrapCommandWithAutoRestart("bun install\nbun run dev", 3);
    expect(wrapped).toContain("  bun install");
    expect(wrapped).toContain("  bun run dev");
    expect(wrapped).not.toContain("  code=$?\n  bun install");
  });

  test("fractional interval is floored", () => {
    expect(wrapCommandWithAutoRestart("bun run dev", 4.9)).toContain("    sleep 4");
  });
});

describe("parseRunRestart", () => {
  test("null and empty raw values fall back to defaults", () => {
    expect(parseRunRestart(null)).toEqual({ enabled: false, intervalSeconds: 5 });
    expect(parseRunRestart("")).toEqual({ enabled: false, intervalSeconds: 5 });
  });

  test("invalid JSON falls back to defaults", () => {
    expect(parseRunRestart("not-json")).toEqual({ enabled: false, intervalSeconds: 5 });
    expect(parseRunRestart("{")).toEqual({ enabled: false, intervalSeconds: 5 });
  });

  test("partial fields fill in defaults", () => {
    expect(parseRunRestart('{"enabled":true}')).toEqual({
      enabled: true,
      intervalSeconds: 5,
    });
    expect(parseRunRestart('{"intervalSeconds":12}')).toEqual({
      enabled: false,
      intervalSeconds: 12,
    });
  });

  test("out-of-range or non-numeric intervals fall back", () => {
    expect(parseRunRestart('{"enabled":true,"intervalSeconds":0}')).toEqual({
      enabled: true,
      intervalSeconds: 5,
    });
    expect(parseRunRestart('{"enabled":true,"intervalSeconds":99999}')).toEqual({
      enabled: true,
      intervalSeconds: 5,
    });
    expect(parseRunRestart('{"enabled":true,"intervalSeconds":"abc"}')).toEqual({
      enabled: true,
      intervalSeconds: 5,
    });
    // 布尔值不是合法 number，必须回落默认（此前 Number(true)===1 会误收）
    expect(parseRunRestart('{"enabled":true,"intervalSeconds":true}')).toEqual({
      enabled: true,
      intervalSeconds: 5,
    });
  });

  test("fractional interval is floored within range", () => {
    expect(parseRunRestart('{"enabled":true,"intervalSeconds":7.6}')).toEqual({
      enabled: true,
      intervalSeconds: 7,
    });
  });

  test("non-boolean enabled is treated as false", () => {
    expect(parseRunRestart('{"enabled":"yes","intervalSeconds":3}')).toEqual({
      enabled: false,
      intervalSeconds: 3,
    });
  });
});
