import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../types";
import {
  buildSubagentCardModel,
  isExplorerNestableToolPart,
  isExplorerSubagentPart,
  isSubagentToolPart,
  parseReadActivityLinesFromText,
  subagentTranscriptIds,
} from "./subagentToolDisplay";

function tool(partial: Partial<ToolUsePart> & Pick<ToolUsePart, "name">): ToolUsePart {
  return {
    type: "tool_use",
    id: partial.id ?? "t1",
    name: partial.name,
    input: partial.input ?? {},
    status: partial.status ?? "running",
    output: partial.output,
    error: partial.error,
    locations: partial.locations,
  };
}

describe("isSubagentToolPart", () => {
  test("detects Task / Agent / subagent names", () => {
    expect(isSubagentToolPart(tool({ name: "Task" }))).toBe(true);
    expect(isSubagentToolPart(tool({ name: "Agent" }))).toBe(true);
    expect(isSubagentToolPart(tool({ name: "run_subagent" }))).toBe(true);
    expect(isSubagentToolPart(tool({ name: "collab_spawnAgent" }))).toBe(true);
  });

  test("detects subagent_type in input", () => {
    expect(
      isSubagentToolPart(
        tool({ name: "other", input: { subagent_type: "explore", description: "x", prompt: "y" } }),
      ),
    ).toBe(true);
  });

  test("does not treat background bash as subagent card", () => {
    expect(
      isSubagentToolPart(
        tool({ name: "Bash", input: { command: "sleep 1", run_in_background: true } }),
      ),
    ).toBe(false);
  });
});

describe("subagentTranscriptIds", () => {
  test("reads Claude result ids without confusing task ids with agents", () => {
    expect(subagentTranscriptIds(tool({ name: "Task", input: { task_id: "task-1" },
      output: "agentId: a123 (use this ID to resume)" }))).toEqual(["a123"]);
    expect(subagentTranscriptIds(tool({ name: "Task", input: { task_id: "task-1" } }))).toEqual([]);
  });

  test("keeps multiple Codex recipients and deduplicates agent states", () => {
    expect(subagentTranscriptIds(tool({ name: "collab_wait", input: {
      receiverThreadIds: ["thread-1", "thread-2"],
      agentsStates: { "thread-2": { status: "completed" }, "thread-3": { status: "running" } },
    } }))).toEqual(["thread-1", "thread-2", "thread-3"]);
  });

  test("reads spawn_agent JSON output and rejects malformed path ids", () => {
    expect(subagentTranscriptIds(tool({ name: "spawn_agent", output: '{"agent_id":"thread-1"}' }))).toEqual(["thread-1"]);
    expect(subagentTranscriptIds(tool({ name: "Task", input: { agentId: "../escape" },
      output: '{"agentId":"/tmp/escape"}' }))).toEqual([]);
  });
});

describe("isExplorerSubagentPart", () => {
  test("explore subtype", () => {
    expect(
      isExplorerSubagentPart(
        tool({
          name: "Task",
          input: { subagent_type: "explore", description: "审计差异", prompt: "compare" },
        }),
      ),
    ).toBe(true);
  });

  test("title ending with Explorer", () => {
    expect(
      isExplorerSubagentPart(
        tool({
          name: "Task",
          input: { title: "审计源↔产物差异 Explorer", prompt: "go" },
        }),
      ),
    ).toBe(true);
  });

  test("regular agent is not explorer", () => {
    expect(
      isExplorerSubagentPart(
        tool({
          name: "Task",
          input: { subagent_type: "generalPurpose", description: "更新 e2e", prompt: "update" },
        }),
      ),
    ).toBe(false);
  });
});

describe("isExplorerNestableToolPart", () => {
  test("Read nests; Task does not", () => {
    expect(isExplorerNestableToolPart(tool({ name: "Read", input: { path: "a.ts" } }))).toBe(true);
    expect(
      isExplorerNestableToolPart(
        tool({ name: "Task", input: { subagent_type: "explore", description: "x", prompt: "y" } }),
      ),
    ).toBe(false);
  });
});

describe("parseReadActivityLinesFromText", () => {
  test("parses Read path ranges", () => {
    const rows = parseReadActivityLinesFromText(
      "Read index.tsx L1-239\nRead EditTable.tsx L1-422\n",
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Read index.tsx L1-239",
      "Read EditTable.tsx L1-422",
    ]);
  });
});

describe("buildSubagentCardModel", () => {
  test("builds waiting explorer model with locations", () => {
    const model = buildSubagentCardModel(
      tool({
        name: "Task",
        status: "running",
        input: {
          description: "审计源↔产物差异",
          prompt: "compare",
          subagent_type: "explore",
        },
        locations: [
          { path: "src/index.tsx", line: 1, endLine: 239 },
          { path: "src/langyalist.ts", line: 1, endLine: 49 },
        ],
        output: "Comparing source page segments",
      }),
    );
    expect(model.kind).toBe("explorer");
    expect(model.waiting).toBe(true);
    expect(model.title).toContain("Explorer");
    expect(model.subtitle).toContain("Comparing");
    expect(model.fileRows).toHaveLength(2);
    expect(model.fileRows[0]?.label).toBe("Read index.tsx L1-239");
  });

  test("prefers childParts over locations", () => {
    const model = buildSubagentCardModel(
      tool({
        name: "Task",
        status: "running",
        input: { subagent_type: "explore", description: "探", prompt: "p" },
        locations: [{ path: "ignored.ts", line: 1 }],
      }),
      [
        tool({
          id: "c1",
          name: "Read",
          input: { path: "src/index.tsx", offset: 1, limit: 239 },
          status: "completed",
        }),
      ],
    );
    expect(model.fileRows).toHaveLength(1);
    expect(model.fileRows[0]?.label).toBe("Read index.tsx L1-239");
  });

  test("subagent card includes model in title", () => {
    const model = buildSubagentCardModel(
      tool({
        name: "Task",
        status: "running",
        input: {
          description: "更新琅琊榜 e2e 与账本",
          prompt: "Updating LangyaList e2e spec",
          model: "Cursor Grok 4.5 High Fast",
          subagent_type: "generalPurpose",
        },
      }),
    );
    expect(model.kind).toBe("subagent");
    expect(model.title).toContain("Cursor Grok 4.5 High Fast");
    expect(model.waiting).toBe(true);
  });
});
