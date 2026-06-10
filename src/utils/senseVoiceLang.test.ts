import { describe, expect, test } from "bun:test";
import {
  normalizeSenseVoiceLanguagePreference,
  senseVoiceLangToInvokeArg,
} from "./senseVoiceLang";

describe("senseVoiceLang", () => {
  test("normalizeSenseVoiceLanguagePreference falls back to auto", () => {
    expect(normalizeSenseVoiceLanguagePreference("invalid")).toBe("auto");
    expect(normalizeSenseVoiceLanguagePreference("zh")).toBe("zh");
  });

  test("senseVoiceLangToInvokeArg passes through auto and short codes", () => {
    expect(senseVoiceLangToInvokeArg("auto")).toBe("auto");
    expect(senseVoiceLangToInvokeArg("yue")).toBe("yue");
  });
});
