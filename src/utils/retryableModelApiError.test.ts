import { describe, expect, test } from "bun:test";
import { isRetryableModelApiError } from "./retryableModelApiError";

describe("isRetryableModelApiError", () => {
  test("matches rate limit and 429", () => {
    expect(isRetryableModelApiError("rate limit exceeded")).toBe(true);
    expect(isRetryableModelApiError("HTTP 429 Too Many Requests")).toBe(true);
  });

  test("matches server overload patterns", () => {
    expect(isRetryableModelApiError("service unavailable")).toBe(true);
    expect(isRetryableModelApiError("model overloaded, try again")).toBe(true);
  });

  test("rejects validation and context errors", () => {
    expect(isRetryableModelApiError("prompt is too long for model")).toBe(false);
    expect(isRetryableModelApiError("JSON parse failed")).toBe(false);
    expect(isRetryableModelApiError("")).toBe(false);
  });
});
