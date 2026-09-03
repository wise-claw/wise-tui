import { describe, expect, test } from "bun:test";
import {
  disableHtml5Drag,
  enableHtml5DragOnPrimaryPointerDown,
  parseWiseRepositoryFileDragPayload,
} from "./repositoryFileDrag";

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

describe("deferred html5 drag", () => {
  test("primary pointer down enables drag, pointer up disables it", () => {
    const el = { draggable: false } as HTMLElement;
    enableHtml5DragOnPrimaryPointerDown({
      button: 0,
      currentTarget: el,
    } as Parameters<typeof enableHtml5DragOnPrimaryPointerDown>[0]);
    expect(el.draggable).toBe(true);
    disableHtml5Drag({ currentTarget: el });
    expect(el.draggable).toBe(false);
  });

  test("non-primary pointer down does not enable drag", () => {
    const el = { draggable: false } as HTMLElement;
    enableHtml5DragOnPrimaryPointerDown({
      button: 2,
      currentTarget: el,
    } as Parameters<typeof enableHtml5DragOnPrimaryPointerDown>[0]);
    expect(el.draggable).toBe(false);
  });
});
