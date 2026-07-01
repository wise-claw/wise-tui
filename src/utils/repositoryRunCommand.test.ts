import { describe, expect, test } from "bun:test";
import {
  buildRunErrorFingerprint,
  decideRunErrorMonitorStep,
  isSameRunErrorFingerprint,
} from "./repositoryRunCommand";

describe("buildRunErrorFingerprint", () => {
  test("同一报错仅时间戳不同时归一到同一指纹", () => {
    const a = "2024-01-01 10:00:01 ERROR Failed to connect to db at line 42";
    const b = "2024-01-01 10:00:09 ERROR Failed to connect to db at line 42";
    expect(buildRunErrorFingerprint(a)).toBe(buildRunErrorFingerprint(b));
  });

  test("循环序号 / 端口每次不同仍归一", () => {
    const a = "retry 1/5: error connection refused on port 5432";
    const b = "retry 4/5: error connection refused on port 5432";
    expect(buildRunErrorFingerprint(a)).toBe(buildRunErrorFingerprint(b));
  });

  test("不同报错产生不同指纹", () => {
    const a = "ERROR Failed to connect to db";
    const b = "ERROR Port 8080 already in use";
    expect(buildRunErrorFingerprint(a)).not.toBe(buildRunErrorFingerprint(b));
  });

  test("剥离 ANSI 控制序列后与纯文本归一一致", () => {
    const withAnsi = "[31mERROR[0m something failed";
    const plain = "ERROR something failed";
    expect(buildRunErrorFingerprint(withAnsi)).toBe(buildRunErrorFingerprint(plain));
  });

  test("多行报错合并为同一指纹，顺序保留", () => {
    const fp = buildRunErrorFingerprint("ERROR line one\nINFO ok\nERROR line two");
    expect(fp).toBe("error line one | error line two");
  });

  test("无错误关键词的日志返回空指纹", () => {
    expect(buildRunErrorFingerprint("all good here\nstarting up")).toBe("");
  });
});

describe("isSameRunErrorFingerprint", () => {
  test("空值不判定为同一（避免误判为循环）", () => {
    expect(isSameRunErrorFingerprint(null, "x")).toBe(false);
    expect(isSameRunErrorFingerprint("", "x")).toBe(false);
    expect(isSameRunErrorFingerprint("x", "")).toBe(false);
  });

  test("相等判定为同一", () => {
    expect(isSameRunErrorFingerprint("fp", "fp")).toBe(true);
    expect(isSameRunErrorFingerprint("a", "b")).toBe(false);
  });
});

describe("decideRunErrorMonitorStep", () => {
  test("未派发时排程首次派发", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: false,
        dispatchedFingerprint: null,
        fingerprint: "fp",
        loopCount: 0,
      }),
    ).toEqual({ action: "arm-dispatch" });
  });

  test("已派发且指纹匹配：递增循环计数，不再派发", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "fp",
        loopCount: 1,
      }),
    ).toEqual({ action: "report-loop", loopCount: 2 });
  });

  test("已派发但指纹不同：提示新报错，不再派发", () => {
    expect(
      decideRunErrorMonitorStep({
        autoFixSent: true,
        dispatchedFingerprint: "fp",
        fingerprint: "other",
        loopCount: 3,
      }),
    ).toEqual({ action: "report-new-after-dispatch" });
  });

  test("已派发但已派发指纹为空：不误判为循环", () => {
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
