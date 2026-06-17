import { describe, expect, test } from "bun:test";
import {
  mergeJsonObjects,
  mergeJsonPatchContent,
  parseFeedbackPatchBackupLine,
} from "./sessionFeedbackConfigPatchJson";
import { previewPatchContent } from "./sessionFeedbackConfigPatch";

describe("sessionFeedbackConfigPatchJson", () => {
  test("mergeJsonObjects deep merges nested keys", () => {
    const out = mergeJsonObjects(
      { hooks: { PreToolUse: [] }, env: { A: "1" } },
      { hooks: { PostToolUse: [{ x: 1 }] }, env: { B: "2" } },
    );
    expect(out.hooks).toEqual({ PreToolUse: [], PostToolUse: [{ x: 1 }] });
    expect(out.env).toEqual({ A: "1", B: "2" });
  });

  test("mergeJsonPatchContent preserves existing settings", () => {
    const out = mergeJsonPatchContent('{"model":"sonnet"}\n', '{"env":{"X":"1"}}');
    const parsed = JSON.parse(out) as { model: string; env: { X: string } };
    expect(parsed.model).toBe("sonnet");
    expect(parsed.env.X).toBe("1");
  });

  test("parseFeedbackPatchBackupLine reads backup record", () => {
    const line = JSON.stringify({
      backupId: "1-p1",
      at: 1000,
      repositoryPath: "/repo",
      patchId: "p1",
      kind: "rule",
      action: "create",
      path: ".claude/rules/x.md",
      rationale: "test",
      before: null,
      after: "# x",
    });
    const rec = parseFeedbackPatchBackupLine(line);
    expect(rec?.backupId).toBe("1-p1");
    expect(rec?.path).toContain("rules");
  });
});

describe("merge_json patch preview", () => {
  test("previewPatchContent merges json for settings", () => {
    const out = previewPatchContent(
      {
        id: "x",
        kind: "settings",
        action: "merge_json",
        path: ".claude/settings.json",
        rationale: "r",
        content: '{"env":{"FOO":"bar"}}',
        source: "ai",
        status: "pending",
      },
      '{"model":"x"}',
    );
    expect(JSON.parse(out)).toEqual({ model: "x", env: { FOO: "bar" } });
  });
});
