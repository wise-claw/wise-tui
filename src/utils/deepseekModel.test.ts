import { describe, expect, test } from "bun:test";
import {
  DEEPSEEK_DEFAULT_MODEL,
  buildDeepSeekModelPickerOptions,
  formatDeepSeekModelLabel,
  isDeepSeekAutoModelId,
  isDeepSeekModelId,
  isDeepseekEncodedModelValue,
  resolveDeepseekExecModelId,
} from "./deepseekModel";

/** Value captured from a real `dsh --profile acp` session/new config option. */
const DSH_V4_FLASH = '["deepseek-official","deepseek-v4-flash"]';

describe("deepseekModel", () => {
  test("default composer model defers to the dsh-configured model", () => {
    expect(DEEPSEEK_DEFAULT_MODEL).toBe("");
    expect(resolveDeepseekExecModelId("")).toBeUndefined();
    expect(resolveDeepseekExecModelId(null)).toBeUndefined();
    expect(resolveDeepseekExecModelId("auto")).toBeUndefined();
  });

  test("passes plain provider ids through", () => {
    expect(isDeepSeekAutoModelId("deepseek-v4-pro")).toBe(false);
    expect(resolveDeepseekExecModelId("deepseek-official/deepseek-v4-pro")).toBe(
      "deepseek-official/deepseek-v4-pro",
    );
    expect(resolveDeepseekExecModelId("  deepseek-chat  ")).toBe("deepseek-chat");
    expect(resolveDeepseekExecModelId("has space")).toBeUndefined();
  });

  test("accepts the JSON-array route strings dsh advertises", () => {
    expect(isDeepseekEncodedModelValue(DSH_V4_FLASH)).toBe(true);
    expect(isDeepseekEncodedModelValue("[]")).toBe(false);
    expect(isDeepseekEncodedModelValue("[not json")).toBe(false);
    expect(isDeepSeekModelId(DSH_V4_FLASH)).toBe(true);
    expect(resolveDeepseekExecModelId(DSH_V4_FLASH)).toBe(DSH_V4_FLASH);
  });

  test("validates against a known catalog when provided", () => {
    const known = [{ id: DSH_V4_FLASH }];
    expect(isDeepSeekModelId(DSH_V4_FLASH, known)).toBe(true);
    expect(isDeepSeekModelId("stale-model", known)).toBe(false);
  });

  test("formats labels with a dsh-default fallback", () => {
    expect(formatDeepSeekModelLabel("")).toBe("默认模型（dsh 配置）");
    expect(formatDeepSeekModelLabel("deepseek-chat", "DeepSeek Chat")).toBe("DeepSeek Chat");
    expect(formatDeepSeekModelLabel("deepseek-chat", "deepseek-chat")).toBe("deepseek-chat");
    expect(formatDeepSeekModelLabel(DSH_V4_FLASH, "DeepSeek-V4-Flash")).toBe("DeepSeek-V4-Flash");
    expect(formatDeepSeekModelLabel(DSH_V4_FLASH)).toBe("deepseek-official/deepseek-v4-flash");
    expect(
      buildDeepSeekModelPickerOptions([{ id: DSH_V4_FLASH, displayName: "DeepSeek-V4-Flash" }]),
    ).toEqual([{ value: DSH_V4_FLASH, label: "DeepSeek-V4-Flash" }]);
  });
});
