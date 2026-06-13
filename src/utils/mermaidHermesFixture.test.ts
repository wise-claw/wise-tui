import { describe, expect, test } from "bun:test";
import { HERMES_AGENT_FLOWCHART } from "./mermaidHermesFixture";
import { normalizeMermaidSourceForRender } from "./mermaidSourceNormalize";

describe("Hermes Agent flowchart fixture", () => {
  test("normalizes multiline labels and implicit connections", () => {
    const output = normalizeMermaidSourceForRender(HERMES_AGENT_FLOWCHART, { plainLabels: true });
    expect(output).toContain("LOOP --> CTX");
    expect(output).toContain("DB --> FTS");
    expect(output).toContain('CLI["hermes CLI / (cli.py 13933 行)"]');
    expect(output).not.toMatch(/^\s*LOOP\s+CTX\s*$/m);
  });
});
