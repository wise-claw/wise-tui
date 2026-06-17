import { describe, expect, test } from "bun:test";
import type { ToolUsePart } from "../types";
import {
  extractToolFileEditPreview,
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
