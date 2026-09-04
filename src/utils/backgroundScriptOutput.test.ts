import { describe, expect, it } from "vitest";
import {
  normalizeBackgroundScriptOutputText,
  resolveBackgroundScriptDisplayText,
} from "./backgroundScriptOutput";

describe("normalizeBackgroundScriptOutputText", () => {
  it("folds consecutive duplicate lines", () => {
    expect(normalizeBackgroundScriptOutputText("你好\n你好\n")).toBe("你好");
    expect(normalizeBackgroundScriptOutputText("a\nb\nb\nc")).toBe("a\nb\nc");
  });

  it("strips ansi codes", () => {
    expect(normalizeBackgroundScriptOutputText("\u001b[31m你好\u001b[0m\n")).toBe("你好");
  });
});

describe("resolveBackgroundScriptDisplayText", () => {
  it("prefers live chunks over fallback", () => {
    expect(resolveBackgroundScriptDisplayText(["你好\n"], "fallback")).toBe("你好");
  });

  it("uses fallback when live is empty", () => {
    expect(resolveBackgroundScriptDisplayText([], "你好\n")).toBe("你好");
  });

  it("does not concatenate live and fallback", () => {
    expect(resolveBackgroundScriptDisplayText(["你好\n"], "你好\n")).toBe("你好");
  });
});
