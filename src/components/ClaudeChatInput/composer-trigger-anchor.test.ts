import { describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import {
  computeSlashPopoverPlacement,
  focusComposerAtPlainOffset,
  plainOffsetToProseMirrorPos,
  resolveSlashPopoverOpaqueBackground,
  resolveSlashPopoverPortalRoot,
} from "./composer-trigger-anchor";

const domWindow = new Window({ url: "https://wise.local/" });
globalThis.window = domWindow as unknown as Window & typeof globalThis.window;
globalThis.document = domWindow.document as unknown as Document;
globalThis.HTMLElement = domWindow.HTMLElement as unknown as typeof HTMLElement;
globalThis.getComputedStyle = domWindow.getComputedStyle.bind(domWindow) as typeof getComputedStyle;

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

describe("focusComposerAtPlainOffset", () => {
  test("sets selection at mapped ProseMirror position", () => {
    const run = mock(() => {});
    const doc = {
      content: { size: 5 },
      textBetween: (from: number, to: number) => {
        const segments = ["", "", "a", "", ""];
        return segments.slice(from, to).join("");
      },
    };
    const editor = {
      state: { doc },
      chain: () => ({
        setTextSelection: (pos: number) => ({
          focus: () => ({
            run,
          }),
        }),
      }),
    };
    const focusEditor = mock(() => {});
    focusComposerAtPlainOffset({ getEditor: () => editor, focusEditor }, 1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(focusEditor).not.toHaveBeenCalled();
  });
});

describe("resolveSlashPopoverPortalRoot", () => {
  test("prefers ant-app ancestor so css-var tokens remain in scope", () => {
    const antApp = document.createElement("div");
    antApp.className = "ant-app css-var-root";
    const anchor = document.createElement("div");
    antApp.appendChild(anchor);
    document.body.appendChild(antApp);
    try {
      expect(resolveSlashPopoverPortalRoot(anchor)).toBe(antApp);
    } finally {
      antApp.remove();
    }
  });
});

describe("resolveSlashPopoverOpaqueBackground", () => {
  test("reads --ant-color-bg-container from themed node", () => {
    const host = document.createElement("div");
    host.style.setProperty("--ant-color-bg-container", "rgb(250, 250, 250)");
    document.body.appendChild(host);
    try {
      expect(resolveSlashPopoverOpaqueBackground(host)).toBe("rgb(250, 250, 250)");
    } finally {
      host.remove();
    }
  });

  test("falls back to white when no token", () => {
    expect(resolveSlashPopoverOpaqueBackground(null)).toBe("#ffffff");
  });
});

describe("computeSlashPopoverPlacement", () => {
  test("returns fixed viewport coords clamped to composer shell", () => {
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
    expect(computeSlashPopoverPlacement(root, caret, 480, { width: 1200, height: 800 })).toEqual({
      left: 118,
      bottom: 554,
    });
  });

  test("clamps left into viewport when shell is wider than viewport remainder", () => {
    const root = {
      getBoundingClientRect: () =>
        ({
          left: 50,
          top: 100,
          right: 850,
          bottom: 200,
          width: 800,
          height: 100,
        }) as DOMRect,
    } as HTMLElement;
    const caret = {
      left: 700,
      top: 160,
      right: 700,
      bottom: 180,
      width: 0,
      height: 20,
    } as DOMRect;
    expect(computeSlashPopoverPlacement(root, caret, 480, { width: 900, height: 600 })).toEqual({
      left: 370,
      bottom: 444,
    });
  });
});
