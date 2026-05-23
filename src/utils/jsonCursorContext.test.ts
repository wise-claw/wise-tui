import { describe, expect, test } from "bun:test";
import {
  isJsonRootPropertyKeyContext,
  jsonBraceDepthBefore,
  partialJsonPropertyKeyPrefix,
} from "./jsonCursorContext";

describe("jsonCursorContext", () => {
  test("jsonBraceDepthBefore ignores braces inside strings", () => {
    expect(jsonBraceDepthBefore('{"a": "{ not depth }"')).toBe(1);
  });

  test("isJsonRootPropertyKeyContext at root property", () => {
    expect(isJsonRootPropertyKeyContext('{\n  "env')).toBe(true);
    expect(isJsonRootPropertyKeyContext('{\n  "env": {\n    "ANTHROPIC_MODEL')).toBe(false);
  });

  test("partialJsonPropertyKeyPrefix", () => {
    expect(partialJsonPropertyKeyPrefix('{\n  "ena')).toBe("ena");
    expect(partialJsonPropertyKeyPrefix('{\n  "env": "x",\n  "mod')).toBe("mod");
  });
});
