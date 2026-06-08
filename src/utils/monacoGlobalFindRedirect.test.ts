import { describe, expect, test } from "bun:test";
import {
  openMonacoFindIfFocused,
  resetMonacoGlobalFindRedirectForTests,
} from "./monacoGlobalFindRedirect";

describe("openMonacoFindIfFocused", () => {
  test("returns false when no Monaco editor is focused", () => {
    resetMonacoGlobalFindRedirectForTests();
    expect(openMonacoFindIfFocused()).toBe(false);
  });
});
