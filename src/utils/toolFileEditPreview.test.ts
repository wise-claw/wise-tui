import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../types";
import {
  buildFileTextDiffLines,
  dedupePathOnlyFileEditParts,
  extractToolFileEditPreview,
  groupFileEditDiffRows,
  isFileEditToolName,
  isToolEditNoiseOutput,
  relativePathInRepository,
} from "./toolFileEditPreview";

function buildPart(overrides: Partial<ToolUsePart> & Pick<ToolUsePart, "name" | "input">): ToolUsePart {
  return {
    id: "tool-1",
    type: "tool_use",
    status: "completed",
    output: "",
    ...overrides,
  };
}

describe("isFileEditToolName", () => {
  test("recognizes common edit/write tool names", () => {
    expect(isFileEditToolName("Edit")).toBe(true);
    expect(isFileEditToolName("write")).toBe(true);
    expect(isFileEditToolName("MultiEdit")).toBe(true);
    expect(isFileEditToolName("search_replace")).toBe(true);
    expect(isFileEditToolName("Read")).toBe(false);
  });

  test("recognizes tool names from each execution environment", () => {
    expect(isFileEditToolName("StrReplace")).toBe(true);
    expect(isFileEditToolName("write_file")).toBe(true);
    expect(isFileEditToolName("replace")).toBe(true);
    expect(isFileEditToolName("mcp__fs__edit_file")).toBe(true);
    expect(isFileEditToolName("apply_patch")).toBe(true);
    expect(isFileEditToolName("FileChange")).toBe(false);
    expect(isFileEditToolName("Read")).toBe(false);
    expect(isFileEditToolName("Bash")).toBe(false);
  });
});

describe("isToolEditNoiseOutput", () => {
  test("detects Cursor-style success messages", () => {
    expect(
      isToolEditNoiseOutput(
        "The file /tmp/a.css has been updated successfully. (file state is current in your context - no need to Read it back)",
      ),
    ).toBe(true);
    expect(isToolEditNoiseOutput("Wrote contents to src/App.tsx")).toBe(true);
    expect(isToolEditNoiseOutput("Actual diff output\nline 2")).toBe(false);
  });
});

describe("extractToolFileEditPreview", () => {
  test("builds write preview with added line count", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "Write",
        input: {
          file_path: "/repo/src/Foo.tsx",
          content: "const a = 1;\nconst b = 2;",
        },
      }),
    );
    expect(preview?.fileName).toBe("Foo.tsx");
    expect(preview?.addedLineCount).toBe(2);
    expect(preview?.lines.every((line) => line.kind === "add")).toBe(true);
    expect(preview?.language).toBe("typescript");
  });

  test("builds edit preview from old/new strings", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "edit",
        input: {
          path: "styles.css",
          old_string: ".a { color: red; }",
          new_string: ".a { color: blue; }\n.b { color: green; }",
        },
      }),
    );
    expect(preview?.fileName).toBe("styles.css");
    expect(preview?.addedLineCount).toBeGreaterThan(0);
    expect(preview?.removedLineCount).toBeGreaterThan(0);
  });

  test("returns null when file path or content is missing", () => {
    expect(
      extractToolFileEditPreview(
        buildPart({
          name: "Edit",
          input: { old_string: "a", new_string: "b" },
        }),
      ),
    ).toBeNull();
    expect(
      extractToolFileEditPreview(
        buildPart({
          name: "Read",
          input: { file_path: "a.ts" },
        }),
      ),
    ).toBeNull();
  });

  test("returns null when input is null/undefined/non-object (streaming interrupt)", () => {
    expect(
      extractToolFileEditPreview(
        buildPart({
          name: "Write",
          input: null as unknown as Record<string, unknown>,
        }),
      ),
    ).toBeNull();
    expect(
      extractToolFileEditPreview(
        buildPart({
          name: "Edit",
          input: undefined as unknown as Record<string, unknown>,
        }),
      ),
    ).toBeNull();
    expect(
      extractToolFileEditPreview(
        buildPart({
          name: "Write",
          input: "not-an-object" as unknown as Record<string, unknown>,
        }),
      ),
    ).toBeNull();
  });
});

describe("relativePathInRepository", () => {
  test("resolves absolute path under repository root", () => {
    expect(
      relativePathInRepository(
        "/Users/me/wise",
        "/Users/me/wise/src/components/Foo.tsx",
      ),
    ).toBe("src/components/Foo.tsx");
  });

  test("passes through existing relative paths", () => {
    expect(relativePathInRepository("/Users/me/wise", "src/App.css")).toBe("src/App.css");
  });

  test("returns null for paths outside repository", () => {
    expect(relativePathInRepository("/Users/me/wise", "/tmp/other.ts")).toBeNull();
  });
});

describe("extractToolFileEditPreview apply_patch", () => {
  test("parses codex apply_patch command into added/removed line preview", () => {
    const part = buildPart({
      name: "apply_patch",
      input: {
        file_path: "src/foo.ts",
        command: [
          "*** Begin Patch",
          "*** Update File: src/foo.ts",
          "@@",
          " const a = 1;",
          "-const a = 1;",
          "+const a = 2;",
          " const b = 2;",
          "*** End Patch",
        ].join("\n"),
      },
    });
    const preview = extractToolFileEditPreview(part);
    expect(preview).not.toBeNull();
    expect(preview?.filePath).toBe("src/foo.ts");
    expect(preview?.addedLineCount).toBe(1);
    expect(preview?.removedLineCount).toBe(1);
    const removed = preview?.lines.find((l) => l.kind === "remove");
    const added = preview?.lines.find((l) => l.kind === "add");
    expect(removed?.text).toBe("const a = 1;");
    expect(added?.text).toBe("const a = 2;");
  });

  test("reads OpenCode filePath plus camelCase old/new strings", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "edit",
        input: {
          filePath: "/repo/src/open.ts",
          oldString: "const a = 1;",
          newString: "const a = 2;",
        },
      }),
    );
    expect(preview?.fileName).toBe("open.ts");
    expect(preview?.addedLineCount).toBeGreaterThan(0);
    expect(preview?.removedLineCount).toBeGreaterThan(0);
  });

  test("reads Cursor write fileText", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "Write",
        input: {
          path: "/repo/src/cursor.ts",
          fileText: "export const n = 1;\n",
        },
      }),
    );
    expect(preview?.fileName).toBe("cursor.ts");
    expect(preview?.addedLineCount).toBe(2);
  });

  test("uses ACP locations when input has no path", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "Edit",
        input: {},
        locations: [{ path: "/repo/src/from-location.py" }],
      }),
    );
    expect(preview?.fileName).toBe("from-location.py");
    expect(preview?.lines).toEqual([]);
  });

  test("reads apply_patch path from the patch header", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "apply_patch",
        input: {
          command: "*** Begin Patch\n*** Update File: src/bar.ts\n@@\n-old\n+new\n*** End Patch",
        },
      }),
    );
    expect(preview?.filePath).toBe("src/bar.ts");
    expect(preview?.addedLineCount).toBe(1);
    expect(preview?.removedLineCount).toBe(1);
  });

  test("returns null for apply_patch without file_path", () => {
    const part = buildPart({
      name: "apply_patch",
      input: {
        command: "*** Begin Patch\n+foo\n*** End Patch",
      },
    });
    expect(extractToolFileEditPreview(part)).toBeNull();
  });

  test("isFileEditToolName accepts apply_patch", () => {
    expect(isFileEditToolName("apply_patch")).toBe(true);
  });

  test("recognizes Cursor titles that embed the file path", () => {
    const name = "Edit `/Users/me/repo/src/toolFileEditPreview.ts`";
    expect(isFileEditToolName(name)).toBe(true);
    const preview = extractToolFileEditPreview(
      buildPart({
        name,
        input: {
          path: "/Users/me/repo/src/toolFileEditPreview.ts",
          old_string: "const a = 1;",
          new_string: "const a = 2;",
        },
      }),
    );
    expect(preview?.fileName).toBe("toolFileEditPreview.ts");
    expect(preview?.addedLineCount).toBeGreaterThan(0);
    expect(preview?.removedLineCount).toBeGreaterThan(0);
  });

  test("reads a path out of the tool title when input has none", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "Edited `/repo/src/only-title.ts`",
        input: { title: "Edited `/repo/src/only-title.ts`" },
      }),
    );
    expect(preview?.fileName).toBe("only-title.ts");
  });

  test("treats Codex add and delete patches without +/- markers as full-file changes", () => {
    const added = extractToolFileEditPreview(
      buildPart({
        name: "apply_patch",
        input: {
          file_path: ".gitignore",
          kind: { type: "add" },
          patch: "node_modules\ndist\n",
        },
      }),
    );
    expect(added?.addedLineCount).toBe(3);
    expect(added?.removedLineCount).toBe(0);
    expect(added?.lines.every((line) => line.kind === "add")).toBe(true);

    const removed = extractToolFileEditPreview(
      buildPart({
        name: "apply_patch",
        input: {
          file_path: "old.txt",
          kind: { type: "delete" },
          patch: "gone\n",
        },
      }),
    );
    expect(removed?.removedLineCount).toBe(2);
    expect(removed?.addedLineCount).toBe(0);
  });

  test("numbers a full-file edit and folds unmodified lines outside the hunk", () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");
    const afterLines = before.split("\n");
    afterLines[20] = "line 21 changed";
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "Edit",
        input: {
          path: "/repo/src/MessageParts.tsx",
          old_string: before,
          new_string: afterLines.join("\n"),
        },
      }),
    );
    const changed = preview?.lines.find((line) => line.kind === "add");
    expect(changed?.newLine).toBe(21);
    expect(changed?.text).toBe("line 21 changed");
    const rows = groupFileEditDiffRows(preview?.lines ?? []);
    const folds = rows.filter((row) => row.type === "fold");
    expect(folds.map((row) => (row.type === "fold" ? row.count : 0))).toEqual([17, 16]);
    const firstLine = rows.find((row) => row.type === "line");
    expect(firstLine?.type === "line" ? firstLine.line.newLine : null).toBe(18);
  });

  test("reads unified diff hunk line numbers", () => {
    const preview = extractToolFileEditPreview(
      buildPart({
        name: "apply_patch",
        input: {
          file_path: "src/foo.ts",
          patch: ["@@ -957,3 +957,4 @@", " const edits = [];", "-if (old) return;", "+const expanded = [];", " return edits;"].join("\n"),
        },
      }),
    );
    const removed = preview?.lines.find((line) => line.kind === "remove");
    const added = preview?.lines.find((line) => line.kind === "add");
    expect(removed?.oldLine).toBe(958);
    expect(added?.newLine).toBe(958);
  });

  test("collapses repeated path-only edits of the same file", () => {
    const part = buildPart({
      name: "Edit `/repo/src/styles/global.css`",
      input: { path: "/repo/src/styles/global.css" },
    });
    const items = [part, { ...part, id: "tool-2" }, { ...part, id: "tool-3" }].map((item, index) => ({
      part: item,
      originalIndex: index,
    }));
    const deduped = dedupePathOnlyFileEditParts(items);
    expect(deduped).toHaveLength(1);
    const lines = buildFileTextDiffLines("a\nb\n", "a\nc\n");
    expect(lines.some((line) => line.kind === "remove" && line.text === "b")).toBe(true);
    expect(lines.some((line) => line.kind === "add" && line.text === "c")).toBe(true);
  });
});
