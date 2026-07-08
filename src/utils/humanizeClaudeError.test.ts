import { describe, expect, test } from "bun:test";
import { HUMANIZE_CLAUDE_ERROR_PATTERNS, humanizeClaudeError } from "./humanizeClaudeError";

describe("humanizeClaudeError", () => {
  test("overloaded -> 服务繁忙 + 附原文", () => {
    expect(humanizeClaudeError("Overloaded")).toBe("服务繁忙，请稍后重试（Overloaded）");
  });

  test("大小写不敏感，原文保留原貌", () => {
    expect(humanizeClaudeError("OVERLOADED")).toBe("服务繁忙，请稍后重试（OVERLOADED）");
  });

  test("529 状态码匹配服务繁忙", () => {
    expect(humanizeClaudeError("HTTP 529")).toBe("服务繁忙，请稍后重试（HTTP 529）");
  });

  test("rate_limit_error -> 频率超限", () => {
    expect(humanizeClaudeError("rate_limit_error")).toBe("请求频率超限，请稍后重试（rate_limit_error）");
  });

  test("too many requests -> 频率超限", () => {
    expect(humanizeClaudeError("Too many requests")).toBe("请求频率超限，请稍后重试（Too many requests）");
  });

  test("ECONNRESET -> 网络异常", () => {
    expect(humanizeClaudeError("ECONNRESET")).toBe("网络连接异常，请检查网络后重试（ECONNRESET）");
  });

  test("connection reset by peer -> 网络异常", () => {
    expect(humanizeClaudeError("connection reset by peer")).toBe(
      "网络连接异常，请检查网络后重试（connection reset by peer）",
    );
  });

  test("timed out -> 请求超时", () => {
    expect(humanizeClaudeError("Request timed out")).toBe("请求超时，请稍后重试（Request timed out）");
  });

  test("billing: insufficient balance -> 额度异常", () => {
    expect(humanizeClaudeError("billing: insufficient balance")).toBe(
      "账户额度不足或计费异常（billing: insufficient balance）",
    );
  });

  test("401 Unauthorized -> 鉴权失败（文字模式优先于状态码）", () => {
    expect(humanizeClaudeError("401 Unauthorized")).toBe("鉴权失败，请检查 API Key（401 Unauthorized）");
  });

  test("503 Service Unavailable -> 服务暂不可用", () => {
    expect(humanizeClaudeError("503 Service Unavailable")).toBe(
      "服务暂不可用，请稍后重试（503 Service Unavailable）",
    );
  });

  test("internal server error -> 服务端异常", () => {
    expect(humanizeClaudeError("internal server error")).toBe(
      "服务端异常，请稍后重试（internal server error）",
    );
  });

  test("400 Bad Request -> 请求参数有误", () => {
    expect(humanizeClaudeError("400 Bad Request")).toBe("请求参数有误（400 Bad Request）");
  });

  test("长原文截断并以省略号结尾", () => {
    const long = `Overloaded: ${"x".repeat(100)}`;
    const result = humanizeClaudeError(long);
    expect(result).toMatch(/^服务繁忙，请稍后重试（.+…）$/);
    expect(result.length).toBeLessThan(long.length + 30);
  });

  test("未识别英文原样返回", () => {
    expect(humanizeClaudeError("some unknown weird error")).toBe("some unknown weird error");
  });

  test("中文原文不匹配原样返回", () => {
    expect(humanizeClaudeError("网络断了")).toBe("网络断了");
  });

  test("空串原样返回", () => {
    expect(humanizeClaudeError("")).toBe("");
  });

  test("仅空白原样返回", () => {
    expect(humanizeClaudeError("   ")).toBe("   ");
  });

  test("patterns 数组非空且结构合法", () => {
    expect(HUMANIZE_CLAUDE_ERROR_PATTERNS.length).toBeGreaterThan(0);
    for (const r of HUMANIZE_CLAUDE_ERROR_PATTERNS) {
      expect(r.pattern).toBeInstanceOf(RegExp);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });
});
