import { describe, expect, test } from "bun:test";
import { parseWiseRepositoryFileDragPayload } from "./repositoryFileDrag";

describe("repositoryFileDrag payload", () => {
  test("parses file payload", () => {
    expect(parseWiseRepositoryFileDragPayload(JSON.stringify({ relativePath: "src/a.ts" }))).toEqual({
      relativePath: "src/a.ts",
      isDir: false,
    });
  });

  test("parses directory payload", () => {
    expect(
      parseWiseRepositoryFileDragPayload(JSON.stringify({ relativePath: "src/hooks", isDir: true })),
    ).toEqual({
      relativePath: "src/hooks",
      isDir: true,
    });
  });

  test("rejects empty or invalid json", () => {
    expect(parseWiseRepositoryFileDragPayload("{}")).toBeNull();
    expect(parseWiseRepositoryFileDragPayload("not-json")).toBeNull();
  });
});
