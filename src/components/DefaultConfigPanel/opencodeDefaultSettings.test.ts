import { describe, expect, test } from "bun:test";
import {
  extractOpencodeMode,
  extractOpencodePermissionJson,
  formatPermissionJson,
  isValidPermissionJson,
  parseOpencodeDefaultSettings,
  serializeOpencodeDefaultSettings,
  toggleOpencodeMode,
} from "./opencodeDefaultSettings";

describe("parseOpencodeDefaultSettings", () => {
  test("空文本返回空对象", () => {
    expect(parseOpencodeDefaultSettings("")).toEqual({});
    expect(parseOpencodeDefaultSettings("   ")).toEqual({});
  });

  test("合法 JSON 对象返回对象", () => {
    expect(parseOpencodeDefaultSettings('{"mode":"custom"}')).toEqual({ mode: "custom" });
  });

  test("非法 JSON 返回 null", () => {
    expect(parseOpencodeDefaultSettings("{not json}")).toBeNull();
    expect(parseOpencodeDefaultSettings('{"unclosed":')).toBeNull();
  });

  test("数组与原始值返回 null", () => {
    expect(parseOpencodeDefaultSettings("[1,2,3]")).toBeNull();
    expect(parseOpencodeDefaultSettings('"str"')).toBeNull();
    expect(parseOpencodeDefaultSettings("42")).toBeNull();
    expect(parseOpencodeDefaultSettings("null")).toBeNull();
  });
});

describe("extractOpencodeMode", () => {
  test("读取 auto/custom", () => {
    expect(extractOpencodeMode('{"mode":"auto"}')).toBe("auto");
    expect(extractOpencodeMode('{"mode":"custom"}')).toBe("custom");
  });

  test("未设置返回 null", () => {
    expect(extractOpencodeMode('{"permissionJson":"{}"}')).toBeNull();
    expect(extractOpencodeMode("")).toBeNull();
  });

  test("非法值返回 null", () => {
    expect(extractOpencodeMode('{"mode":"other"}')).toBeNull();
    expect(extractOpencodeMode('{"mode":123}')).toBeNull();
    expect(extractOpencodeMode("invalid")).toBeNull();
  });
});

describe("extractOpencodePermissionJson", () => {
  test("读取 permissionJson 文本", () => {
    expect(
      extractOpencodePermissionJson('{"mode":"custom","permissionJson":"{\\"bash\\":{}}"}'),
    ).toBe('{"bash":{}}');
  });

  test("未设置返回空串", () => {
    expect(extractOpencodePermissionJson('{"mode":"custom"}')).toBe("");
    expect(extractOpencodePermissionJson("")).toBe("");
  });

  test("非字符串返回空串", () => {
    expect(extractOpencodePermissionJson('{"permissionJson":123}')).toBe("");
  });

  test("非法 JSON 返回空串", () => {
    expect(extractOpencodePermissionJson("invalid")).toBe("");
  });
});

describe("serializeOpencodeDefaultSettings", () => {
  test("auto 或 null 返回空串", () => {
    expect(serializeOpencodeDefaultSettings("auto", '{"bash":{}}')).toBe("");
    expect(serializeOpencodeDefaultSettings(null, '{"bash":{}}')).toBe("");
  });

  test("custom 无 permissionJson 仅存 mode", () => {
    expect(JSON.parse(serializeOpencodeDefaultSettings("custom", ""))).toEqual({ mode: "custom" });
    expect(JSON.parse(serializeOpencodeDefaultSettings("custom", null))).toEqual({
      mode: "custom",
    });
  });

  test("custom 带 permissionJson", () => {
    const result = serializeOpencodeDefaultSettings("custom", '{"bash":{"rm *":"deny"}}');
    expect(JSON.parse(result)).toEqual({
      mode: "custom",
      permissionJson: '{"bash":{"rm *":"deny"}}',
    });
  });

  test("trim permissionJson", () => {
    const result = serializeOpencodeDefaultSettings("custom", "  {}  ");
    expect(JSON.parse(result)).toEqual({ mode: "custom", permissionJson: "{}" });
  });
});

describe("toggleOpencodeMode", () => {
  test("切到 custom 保留已有 permissionJson", () => {
    const result = toggleOpencodeMode(
      '{"mode":"custom","permissionJson":"{\\"bash\\":{}}"}',
      "custom",
    );
    expect(JSON.parse(result)).toEqual({
      mode: "custom",
      permissionJson: '{"bash":{}}',
    });
  });

  test("切到 auto 返回空串", () => {
    expect(toggleOpencodeMode('{"mode":"custom","permissionJson":"{}"}', "auto")).toBe("");
  });

  test("从 auto/空切到 custom 无 permissionJson", () => {
    expect(JSON.parse(toggleOpencodeMode("", "custom"))).toEqual({ mode: "custom" });
    expect(JSON.parse(toggleOpencodeMode('{"mode":"auto"}', "custom"))).toEqual({
      mode: "custom",
    });
  });

  test("对非法文本切 custom 按空对象处理", () => {
    expect(JSON.parse(toggleOpencodeMode("invalid", "custom"))).toEqual({ mode: "custom" });
  });
});

describe("formatPermissionJson", () => {
  test("空文本返回空串", () => {
    expect(formatPermissionJson("")).toBe("");
    expect(formatPermissionJson("   ")).toBe("");
  });

  test("格式化 JSON", () => {
    expect(formatPermissionJson('{"b":1,"a":2}')).toBe('{\n  "b": 1,\n  "a": 2\n}');
  });

  test("非法 JSON 抛错", () => {
    expect(() => formatPermissionJson("{bad}")).toThrow();
  });
});

describe("isValidPermissionJson", () => {
  test("空文本合法", () => {
    expect(isValidPermissionJson("")).toBe(true);
    expect(isValidPermissionJson("   ")).toBe(true);
  });

  test("合法 JSON 合法", () => {
    expect(isValidPermissionJson('{"bash":{"rm *":"deny"}}')).toBe(true);
    expect(isValidPermissionJson("{}")).toBe(true);
  });

  test("非法 JSON 不合法", () => {
    expect(isValidPermissionJson("{bad}")).toBe(false);
    expect(isValidPermissionJson('{"unclosed":')).toBe(false);
  });
});
