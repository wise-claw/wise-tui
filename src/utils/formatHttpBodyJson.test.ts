import { describe, expect, test } from "bun:test";
import {
  formatHttpBodyJsonForDisplay,
  HTTP_BODY_TRUNCATION_MARKER,
  stripHttpBodyTruncationMarker,
} from "./formatHttpBodyJson";

describe("formatHttpBodyJson", () => {
  test("pretty-prints compact JSON", () => {
    const out = formatHttpBodyJsonForDisplay('{"max_tokens":32000,"messages":[]}');
    expect(out).toContain('"max_tokens": 32000');
    expect(out).toContain("\n");
  });

  test("strips truncation marker and pretty-prints valid prefix", () => {
    const compact = JSON.stringify({ model: "qwen", messages: [{ role: "user", content: "hi" }] });
    const raw = compact.slice(0, 40) + HTTP_BODY_TRUNCATION_MARKER;
    const out = formatHttpBodyJsonForDisplay(raw);
    expect(out).toContain('"model"');
    expect(out).toContain("预览已截断");
    expect(out).not.toContain(HTTP_BODY_TRUNCATION_MARKER);
  });

  test("unwraps double-encoded JSON string", () => {
    const inner = JSON.stringify({ a: 1 });
    const wrapped = JSON.stringify(inner);
    const out = formatHttpBodyJsonForDisplay(wrapped);
    expect(out).toContain('"a": 1');
  });

  test("stripHttpBodyTruncationMarker", () => {
    expect(stripHttpBodyTruncationMarker(`{"x":1}${HTTP_BODY_TRUNCATION_MARKER}`)).toEqual({
      body: '{"x":1}',
      wasTruncated: true,
    });
  });
});
