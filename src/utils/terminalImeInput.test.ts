import { describe, expect, test } from "bun:test";
import {
  shouldDeferTerminalKeyToInput,
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

  test("shouldDeferTerminalKeyToInput defers ASCII punctuation but not alnum", () => {
    expect(
      shouldDeferTerminalKeyToInput({
        key: ",",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferTerminalKeyToInput({
        key: ".",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferTerminalKeyToInput({
        key: " ",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferTerminalKeyToInput({
        key: "a",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferTerminalKeyToInput({
        key: "7",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferTerminalKeyToInput({
        key: "，",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferTerminalKeyToInput({
        key: ",",
        ctrlKey: true,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false);
  });

  test("terminalTextFromCompositionEnd returns committed text", () => {
    expect(terminalTextFromCompositionEnd({ data: "除了" })).toBe("除了");
    expect(terminalTextFromCompositionEnd({ data: "" })).toBe("");
  });

  test("terminalTextFromNonImeInput accepts Chinese punctuation insertText", () => {
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
    expect(
      terminalTextFromNonImeInput(
        { data: "，", inputType: "insertText", isComposing: false },
        false,
      ),
    ).toBe("，");
    expect(
      terminalTextFromNonImeInput(
        { data: "。", inputType: "insertText", isComposing: false },
        false,
      ),
    ).toBe("。");
  });
});
