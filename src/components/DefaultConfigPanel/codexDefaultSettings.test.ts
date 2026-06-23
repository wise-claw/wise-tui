import { describe, expect, test } from "bun:test";
import {
  extractCodexApprovalPolicy,
  extractCodexSandboxMode,
  isFullAccessInCodexSettings,
  parseCodexDefaultSettings,
  serializeCodexDefaultSettings,
  toggleFullAccessInCodexSettings,
} from "./codexDefaultSettings";

describe("parseCodexDefaultSettings", () => {
  test("空文本返回空对象", () => {
    expect(parseCodexDefaultSettings("")).toEqual({});
    expect(parseCodexDefaultSettings("   ")).toEqual({});
  });

  test("合法 JSON 对象返回对象", () => {
    expect(parseCodexDefaultSettings('{"sandboxMode":"read-only"}')).toEqual({
      sandboxMode: "read-only",
    });
  });

  test("非法 JSON 返回 null", () => {
    expect(parseCodexDefaultSettings("{not json}")).toBeNull();
    expect(parseCodexDefaultSettings('{"unclosed":')).toBeNull();
  });

  test("数组与原始值返回 null", () => {
    expect(parseCodexDefaultSettings("[1,2,3]")).toBeNull();
    expect(parseCodexDefaultSettings('"str"')).toBeNull();
    expect(parseCodexDefaultSettings("42")).toBeNull();
    expect(parseCodexDefaultSettings("null")).toBeNull();
  });
});

describe("extractCodexSandboxMode / extractCodexApprovalPolicy", () => {
  test("读取已设置的值", () => {
    const text = '{"sandboxMode":"danger-full-access","approvalPolicy":"never"}';
    expect(extractCodexSandboxMode(text)).toBe("danger-full-access");
    expect(extractCodexApprovalPolicy(text)).toBe("never");
  });

  test("未设置返回 null", () => {
    expect(extractCodexSandboxMode('{"approvalPolicy":"never"}')).toBeNull();
    expect(extractCodexApprovalPolicy('{"sandboxMode":"read-only"}')).toBeNull();
  });

  test("空文本返回 null", () => {
    expect(extractCodexSandboxMode("")).toBeNull();
    expect(extractCodexApprovalPolicy("")).toBeNull();
  });

  test("非法 JSON 返回 null", () => {
    expect(extractCodexSandboxMode("invalid")).toBeNull();
    expect(extractCodexApprovalPolicy("invalid")).toBeNull();
  });

  test("非字符串值返回 null", () => {
    expect(extractCodexSandboxMode('{"sandboxMode":123}')).toBeNull();
    expect(extractCodexApprovalPolicy('{"approvalPolicy":true}')).toBeNull();
  });
});

describe("serializeCodexDefaultSettings", () => {
  test("两者都为空返回空串", () => {
    expect(serializeCodexDefaultSettings(null, null)).toBe("");
    expect(serializeCodexDefaultSettings("", "")).toBe("");
    expect(serializeCodexDefaultSettings("  ", "  ")).toBe("");
  });

  test("仅 sandboxMode", () => {
    expect(JSON.parse(serializeCodexDefaultSettings("read-only", null))).toEqual({
      sandboxMode: "read-only",
    });
  });

  test("仅 approvalPolicy", () => {
    expect(JSON.parse(serializeCodexDefaultSettings(null, "never"))).toEqual({
      approvalPolicy: "never",
    });
  });

  test("两者都设置", () => {
    expect(JSON.parse(serializeCodexDefaultSettings("workspace-write", "on-request"))).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
  });

  test("trim 空白", () => {
    expect(JSON.parse(serializeCodexDefaultSettings("  read-only  ", "  never  "))).toEqual({
      sandboxMode: "read-only",
      approvalPolicy: "never",
    });
  });
});

describe("isFullAccessInCodexSettings", () => {
  test("danger-full-access + never 为真", () => {
    expect(
      isFullAccessInCodexSettings('{"sandboxMode":"danger-full-access","approvalPolicy":"never"}'),
    ).toBe(true);
  });

  test("仅 sandboxMode 为 danger-full-access 但 policy 非 never 为假", () => {
    expect(
      isFullAccessInCodexSettings('{"sandboxMode":"danger-full-access","approvalPolicy":"on-request"}'),
    ).toBe(false);
  });

  test("policy 为 never 但 sandboxMode 非 danger-full-access 为假", () => {
    expect(
      isFullAccessInCodexSettings('{"sandboxMode":"workspace-write","approvalPolicy":"never"}'),
    ).toBe(false);
  });

  test("空文本为假", () => {
    expect(isFullAccessInCodexSettings("")).toBe(false);
  });

  test("非法 JSON 为假", () => {
    expect(isFullAccessInCodexSettings("invalid")).toBe(false);
  });
});

describe("toggleFullAccessInCodexSettings", () => {
  test("开启：空文本变成取消沙箱限制对象", () => {
    expect(JSON.parse(toggleFullAccessInCodexSettings("", true))).toEqual({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  test("开启：覆盖已有值", () => {
    const result = toggleFullAccessInCodexSettings(
      '{"sandboxMode":"workspace-write","approvalPolicy":"on-request"}',
      true,
    );
    expect(JSON.parse(result)).toEqual({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  test("关闭：清空两字段返回空串", () => {
    expect(
      toggleFullAccessInCodexSettings(
        '{"sandboxMode":"danger-full-access","approvalPolicy":"never"}',
        false,
      ),
    ).toBe("");
  });

  test("关闭：仅清这两字段", () => {
    const result = toggleFullAccessInCodexSettings(
      '{"sandboxMode":"danger-full-access","approvalPolicy":"never","extra":1}',
      false,
    );
    expect(JSON.parse(result)).toEqual({ extra: 1 });
  });

  test("关闭空文本幂等返回空串", () => {
    expect(toggleFullAccessInCodexSettings("", false)).toBe("");
  });

  test("对非法文本开启按空对象处理", () => {
    expect(JSON.parse(toggleFullAccessInCodexSettings("invalid", true))).toEqual({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  test("已开启再开启幂等", () => {
    const result = toggleFullAccessInCodexSettings(
      '{"sandboxMode":"danger-full-access","approvalPolicy":"never"}',
      true,
    );
    expect(JSON.parse(result)).toEqual({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });
});
