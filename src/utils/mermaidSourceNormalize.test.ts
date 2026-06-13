import { describe, expect, test } from "bun:test";
import {
  buildMermaidRenderAttempts,
  normalizeMermaidSourceForRender,
} from "./mermaidSourceNormalize";

describe("normalizeMermaidSourceForRender", () => {
  test("converts multiline bracket labels to br tags", () => {
    const input = `flowchart TB
  CLI["hermes CLI
(cli.py 13933 行)"]`;
    const output = normalizeMermaidSourceForRender(input);
    expect(output).toContain('CLI["hermes CLI<br/>(cli.py 13933 行)"]');
    expect(output).not.toMatch(/CLI\["hermes CLI\n/);
  });

  test("sanitizes arrow sequences inside quoted labels", () => {
    const input = 'LOOP["Conversation Loop (user -> LLM -> tools -> reply)"]';
    const output = normalizeMermaidSourceForRender(input);
    expect(output).toBe('LOOP["Conversation Loop (user → LLM → tools → reply)"]');
    expect(output).not.toContain("->");
  });

  test("balances missing subgraph end markers", () => {
    const input = `flowchart TB
subgraph ENTRY["入口"]
  A["node"]
subgraph AGENT["核心"]
  B["node"]`;
    const output = normalizeMermaidSourceForRender(input);
    expect(output.match(/^end\b/gim)?.length).toBe(2);
  });

  test("repairs dangling quoted labels", () => {
    const input = 'CLI["hermes CLI (cli.py 13933 行)"';
    expect(normalizeMermaidSourceForRender(input)).toBe('CLI["hermes CLI (cli.py 13933 行)"]');
  });

  test("plain label mode strips br tags", () => {
    const input = 'A["line1<br/>line2"]';
    expect(normalizeMermaidSourceForRender(input, { plainLabels: true })).toBe('A["line1 / line2"]');
  });

  test("aggressive mode removes direction lines", () => {
    const input = "subgraph ENTRY\n  direction LR\n  A --> B\nend";
    expect(normalizeMermaidSourceForRender(input, { aggressive: true })).not.toContain("direction LR");
  });

  test("repairs implicit node connections without arrows", () => {
    const input = "flowchart TB\n    LOOP  CTX\n    DB  FTS";
    const output = normalizeMermaidSourceForRender(input, { plainLabels: true });
    expect(output).toMatch(/^flowchart TB/m);
    expect(output).not.toMatch(/flowchart\s+-->\s+TB/);
    expect(output).toContain("LOOP --> CTX");
    expect(output).toContain("DB --> FTS");
    expect(output).not.toMatch(/^\s*LOOP\s+CTX\s*$/m);
  });
});

describe("buildMermaidRenderAttempts", () => {
  test("prefers plain svg labels before html labels", () => {
    const attempts = buildMermaidRenderAttempts('flowchart TB\n  A["x<br/>y"] --> B');
    expect(attempts[0]?.htmlLabels).toBe(false);
    expect(attempts.some((item) => item.htmlLabels)).toBe(true);
  });
});
