import { describe, expect, test } from "bun:test";
import {
  extractPermissionMode,
  formatClaudeDefaultSettings,
  isSandboxDisabledInSettings,
  isUltracodeEnabledInSettings,
  parseClaudeDefaultSettings,
  setPermissionModeInSettings,
  toggleSandboxDisabledInSettings,
  toggleUltracodeInSettings,
} from "./claudeDefaultSettings";

describe("parseClaudeDefaultSettings", () => {
  test("空文本返回空对象", () => {
    expect(parseClaudeDefaultSettings("")).toEqual({});
    expect(parseClaudeDefaultSettings("   ")).toEqual({});
  });

  test("合法 JSON 对象返回对象", () => {
    expect(parseClaudeDefaultSettings('{"ultracode": true}')).toEqual({ ultracode: true });
  });

  test("非法 JSON 返回 null", () => {
    expect(parseClaudeDefaultSettings("{not json}")).toBeNull();
    expect(parseClaudeDefaultSettings('{"unclosed":')).toBeNull();
  });

  test("数组与原始值返回 null", () => {
    expect(parseClaudeDefaultSettings("[1,2,3]")).toBeNull();
    expect(parseClaudeDefaultSettings('"str"')).toBeNull();
    expect(parseClaudeDefaultSettings("42")).toBeNull();
    expect(parseClaudeDefaultSettings("null")).toBeNull();
  });
});

describe("isUltracodeEnabledInSettings", () => {
  test("ultracode:true 为开", () => {
    expect(isUltracodeEnabledInSettings('{"ultracode": true}')).toBe(true);
  });

  test("ultracode:false 为关", () => {
    expect(isUltracodeEnabledInSettings('{"ultracode": false}')).toBe(false);
  });

  test("无 ultracode 键为关", () => {
    expect(isUltracodeEnabledInSettings('{"foo": 1}')).toBe(false);
  });

  test("非法 JSON 为关", () => {
    expect(isUltracodeEnabledInSettings("invalid")).toBe(false);
  });
});

describe("toggleUltracodeInSettings", () => {
  test("开启：空文本变成 ultracode 对象", () => {
    expect(JSON.parse(toggleUltracodeInSettings("", true))).toEqual({
      ultracode: true,
    });
  });

  test("开启：保留其它键", () => {
    const result = toggleUltracodeInSettings('{"permissions":{"allow":["Bash"]}}', true);
    expect(JSON.parse(result)).toEqual({
      permissions: { allow: ["Bash"] },
      ultracode: true,
    });
  });

  test("关闭：移除 ultracode 键，保留其它", () => {
    const result = toggleUltracodeInSettings('{"ultracode": true, "foo": 1}', false);
    expect(JSON.parse(result)).toEqual({ foo: 1 });
  });

  test("关闭：移除 ultracode 同步移除 effortLevel ultracode", () => {
    const result = toggleUltracodeInSettings(
      '{"ultracode": true, "effortLevel": "ultracode", "foo": 1}',
      false,
    );
    expect(JSON.parse(result)).toEqual({ foo: 1 });
  });

  test("关闭：保留用户自定义 effortLevel（非 ultracode）", () => {
    const result = toggleUltracodeInSettings(
      '{"ultracode": true, "effortLevel": "high", "foo": 1}',
      false,
    );
    expect(JSON.parse(result)).toEqual({ effortLevel: "high", foo: 1 });
  });

  test("关闭后剩空对象返回空串", () => {
    expect(toggleUltracodeInSettings('{"ultracode": true}', false)).toBe("");
  });

  test("对非法文本开启按空对象处理", () => {
    expect(JSON.parse(toggleUltracodeInSettings("invalid", true))).toEqual({
      ultracode: true,
    });
  });

  test("已开启再开启幂等", () => {
    const result = toggleUltracodeInSettings('{"ultracode": true}', true);
    expect(JSON.parse(result)).toEqual({ ultracode: true });
  });
});

describe("formatClaudeDefaultSettings", () => {
  test("空文本返回空串", () => {
    expect(formatClaudeDefaultSettings("")).toBe("");
    expect(formatClaudeDefaultSettings("   ")).toBe("");
  });

  test("格式化 JSON 对象（保持键顺序）", () => {
    expect(formatClaudeDefaultSettings('{"b":1,"a":2}')).toBe('{\n  "b": 1,\n  "a": 2\n}');
  });

  test("非法 JSON 抛错", () => {
    expect(() => formatClaudeDefaultSettings("{bad}")).toThrow();
  });

  test("数组抛错", () => {
    expect(() => formatClaudeDefaultSettings("[1,2]")).toThrow();
  });
});

describe("isSandboxDisabledInSettings", () => {
  test("sandbox.enabled:false 为已取消", () => {
    expect(isSandboxDisabledInSettings('{"sandbox":{"enabled":false}}')).toBe(true);
  });

  test("sandbox.enabled:true 为未取消", () => {
    expect(isSandboxDisabledInSettings('{"sandbox":{"enabled":true}}')).toBe(false);
  });

  test("无 sandbox 键为未取消", () => {
    expect(isSandboxDisabledInSettings('{"ultracode":true}')).toBe(false);
  });

  test("非法 JSON 为未取消", () => {
    expect(isSandboxDisabledInSettings("invalid")).toBe(false);
  });
});

describe("toggleSandboxDisabledInSettings", () => {
  test("开启：空文本注入 sandbox.enabled:false", () => {
    expect(JSON.parse(toggleSandboxDisabledInSettings("", true))).toEqual({
      sandbox: { enabled: false },
    });
  });

  test("开启：保留其它顶层键与 sandbox 子键", () => {
    const result = toggleSandboxDisabledInSettings(
      '{"ultracode":true,"sandbox":{"allowWrite":["/tmp"]}}',
      true,
    );
    expect(JSON.parse(result)).toEqual({
      ultracode: true,
      sandbox: { allowWrite: ["/tmp"], enabled: false },
    });
  });

  test("关闭：移除 enabled，保留 sandbox 其它子键", () => {
    const result = toggleSandboxDisabledInSettings(
      '{"sandbox":{"enabled":false,"allowWrite":["/tmp"]}}',
      false,
    );
    expect(JSON.parse(result)).toEqual({ sandbox: { allowWrite: ["/tmp"] } });
  });

  test("关闭后 sandbox 仅剩空对象则移除 sandbox 键并返回空串", () => {
    expect(toggleSandboxDisabledInSettings('{"sandbox":{"enabled":false}}', false)).toBe("");
  });

  test("对非法文本开启按空对象处理", () => {
    expect(JSON.parse(toggleSandboxDisabledInSettings("invalid", true))).toEqual({
      sandbox: { enabled: false },
    });
  });

  test("已开启再开启幂等", () => {
    const result = toggleSandboxDisabledInSettings('{"sandbox":{"enabled":false}}', true);
    expect(JSON.parse(result)).toEqual({ sandbox: { enabled: false } });
  });
});

describe("extractPermissionMode", () => {
  test("四个合法值各返回对应", () => {
    expect(extractPermissionMode('{"permissionMode":"default"}')).toBe("default");
    expect(extractPermissionMode('{"permissionMode":"acceptEdits"}')).toBe("acceptEdits");
    expect(extractPermissionMode('{"permissionMode":"plan"}')).toBe("plan");
    expect(extractPermissionMode('{"permissionMode":"bypassPermissions"}')).toBe("bypassPermissions");
  });

  test("未设置 permissionMode 返回 null", () => {
    expect(extractPermissionMode('{"ultracode":true}')).toBeNull();
  });

  test("未知串返回 null（防注入）", () => {
    expect(extractPermissionMode('{"permissionMode":"bypass"}')).toBeNull();
    expect(extractPermissionMode('{"permissionMode":"--danger"}')).toBeNull();
  });

  test("非字符串值返回 null", () => {
    expect(extractPermissionMode('{"permissionMode":1}')).toBeNull();
    expect(extractPermissionMode('{"permissionMode":true}')).toBeNull();
    expect(extractPermissionMode('{"permissionMode":null}')).toBeNull();
  });

  test("空文本与非法 JSON 返回 null", () => {
    expect(extractPermissionMode("")).toBeNull();
    expect(extractPermissionMode("invalid")).toBeNull();
  });
});

describe("setPermissionModeInSettings", () => {
  test("设置合法值：空文本注入 permissionMode", () => {
    expect(JSON.parse(setPermissionModeInSettings("", "bypassPermissions"))).toEqual({
      permissionMode: "bypassPermissions",
    });
  });

  test("设置合法值：保留其它顶层键与子对象", () => {
    const result = setPermissionModeInSettings(
      '{"ultracode":true,"sandbox":{"enabled":false}}',
      "plan",
    );
    expect(JSON.parse(result)).toEqual({
      ultracode: true,
      sandbox: { enabled: false },
      permissionMode: "plan",
    });
  });

  test("切换值：覆盖旧 permissionMode", () => {
    const result = setPermissionModeInSettings('{"permissionMode":"plan"}', "default");
    expect(JSON.parse(result)).toEqual({ permissionMode: "default" });
  });

  test("传入 null：移除 permissionMode，保留其它键", () => {
    const result = setPermissionModeInSettings(
      '{"ultracode":true,"permissionMode":"plan"}',
      null,
    );
    expect(JSON.parse(result)).toEqual({ ultracode: true });
  });

  test("传入 null：仅剩 permissionMode 时移除后返回空串", () => {
    expect(setPermissionModeInSettings('{"permissionMode":"plan"}', null)).toBe("");
  });

  test("对非法文本设置按空对象处理", () => {
    expect(JSON.parse(setPermissionModeInSettings("invalid", "plan"))).toEqual({
      permissionMode: "plan",
    });
  });

  test("已设同值再设幂等", () => {
    const result = setPermissionModeInSettings('{"permissionMode":"plan"}', "plan");
    expect(JSON.parse(result)).toEqual({ permissionMode: "plan" });
  });
});
