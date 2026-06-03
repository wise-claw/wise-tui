import { describe, expect, test } from "bun:test";
import {
  computeSlashPopoverPlacement,
  plainOffsetToProseMirrorPos,
} from "./composer-trigger-anchor";

describe("plainOffsetToProseMirrorPos", () => {
  test("offset 0 maps before first plain character, not document head", () => {
    const doc = {
      content: { size: 5 },
      textBetween: (from: number, to: number, sep?: string) => {
        void sep;
        const segments = ["", "", "@", "", ""];
        return segments.slice(from, to).join("");
      },
    };
    const editor = { state: { doc } } as Parameters<typeof plainOffsetToProseMirrorPos>[0];
    expect(plainOffsetToProseMirrorPos(editor, 0)).toBe(2);
    expect(plainOffsetToProseMirrorPos(editor, 1)).toBe(5);
  });
});

describe("computeSlashPopoverPlacement", () => {
  test("left is caret minus position root", () => {
    const root = {
      getBoundingClientRect: () =>
        ({
          left: 100,
          top: 200,
          right: 700,
          bottom: 300,
          width: 600,
          height: 100,
        }) as DOMRect,
    } as HTMLElement;
    const caret = {
      left: 118,
      top: 250,
      right: 118,
      bottom: 270,
      width: 0,
      height: 20,
    } as DOMRect;
    expect(computeSlashPopoverPlacement(root, caret)).toEqual({ left: 18, bottom: 54 });
  });
});
