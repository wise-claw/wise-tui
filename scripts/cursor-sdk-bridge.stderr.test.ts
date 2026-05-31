import { describe, expect, test } from "bun:test";
import { isCursorSdkNoiseStderr } from "./cursorSdkStderrFilter.ts";

describe("isCursorSdkNoiseStderr", () => {
  test("filters Connect RPC HTTP/2 stream close noise", () => {
    expect(
      isCursorSdkNoiseStderr(
        "ConnectError: [internal] Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR",
      ),
    ).toBe(true);
  });

  test("filters connect-error.js source context lines", () => {
    expect(
      isCursorSdkNoiseStderr(
        "66 | // Fetch requests can only be canceled with an AbortController.",
      ),
    ).toBe(true);
    expect(
      isCursorSdkNoiseStderr(
        "return new ConnectError(reason.message, code, undefined, undefined, reason);",
      ),
    ).toBe(true);
  });

  test("filters ConnectError metadata tail lines", () => {
    expect(isCursorSdkNoiseStderr("code: 13,")).toBe(true);
    expect(isCursorSdkNoiseStderr("metadata: Headers {},")).toBe(true);
    expect(isCursorSdkNoiseStderr("details: [],")).toBe(true);
  });

  test("filters stack frames from connect packages", () => {
    expect(
      isCursorSdkNoiseStderr(
        "    at from (/Users/sjl/Documents/github/wise/node_modules/@connectrpc/connect/dist/esm/connect-error.js:71:20)",
      ),
    ).toBe(true);
  });
});
