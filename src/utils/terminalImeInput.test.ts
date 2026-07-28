import { describe, expect, test } from "bun:test";
import {
  shouldIgnoreTerminalKeyDuringIme,
  terminalTextFromCompositionEnd,
  terminalTextFromNonImeInput,
} from "./terminalImeInput";

describe("terminalImeInput", () => {
  test("shouldIgnoreTerminalKeyDuringIme blocks composing / Process / 229", () => {
    expect(
      shouldIgnoreTerminalKeyDuringIme({
        isComposing: true,
        key: "c",
        keyCode: 67,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTerminalKeyDuringIme({
        isComposing: false,
        key: "Process",
        keyCode: 229,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTerminalKeyDuringIme({
        isComposing: false,
        key: "c",
        keyCode: 229,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTerminalKeyDuringIme({
        isComposing: false,
        key: "c",
        keyCode: 67,
      }),
    ).toBe(false);
  });

  test("terminalTextFromCompositionEnd returns committed text", () => {
    expect(terminalTextFromCompositionEnd({ data: "除了" })).toBe("除了");
    expect(terminalTextFromCompositionEnd({ data: "" })).toBe("");
  });

  test("terminalTextFromNonImeInput skips composition updates", () => {
    expect(
      terminalTextFromNonImeInput(
        { data: "cle", inputType: "insertCompositionText", isComposing: true },
        true,
      ),
    ).toBeNull();
    expect(
      terminalTextFromNonImeInput(
        { data: "除了", inputType: "insertCompositionText", isComposing: false },
        false,
      ),
    ).toBeNull();
    expect(
      terminalTextFromNonImeInput(
        { data: "x", inputType: "insertText", isComposing: false },
        false,
      ),
    ).toBe("x");
  });
});
