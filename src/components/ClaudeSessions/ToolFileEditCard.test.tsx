import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ToolFileEditPreview } from "../../utils/toolFileEditPreview";
import { ToolFileEditCard } from "./ToolFileEditCard";

/** 回归测试：独立成卡时头部按 Codex 桌面端展示「写入文件 · en.md」。 */

const OVERRIDDEN_GLOBAL_KEYS = [
  "window", "document", "HTMLElement", "HTMLDivElement", "HTMLUListElement",
  "HTMLLIElement", "HTMLButtonElement", "HTMLSpanElement", "Element", "Node",
  "Event", "MouseEvent", "getComputedStyle", "ResizeObserver", "requestAnimationFrame",
  "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT",
] as const;

let domWindow: Window | null = null;
let container: HTMLElement;
let root: Root | null = null;
let savedGlobals: Record<string, unknown> = {};

const preview: ToolFileEditPreview = {
  filePath: "/repo/docs/en.md",
  fileName: "en.md",
  addedLineCount: 2,
  removedLineCount: 0,
  language: "markdown",
  truncated: false,
  lines: [
    { kind: "add", text: "# Git 与协作", oldLine: null, newLine: 1 },
    { kind: "add", text: "", oldLine: null, newLine: 2 },
  ],
};

beforeEach(() => {
  savedGlobals = {};
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    savedGlobals[key] = (globalThis as unknown as Record<string, unknown>)[key];
  }
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  domWindow = new Window({ url: "http://localhost/" });
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    if (key === "IS_REACT_ACT_ENVIRONMENT") continue;
    (globalThis as unknown as Record<string, unknown>)[key] =
      (domWindow as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  for (const key of OVERRIDDEN_GLOBAL_KEYS) {
    (globalThis as unknown as Record<string, unknown>)[key] = savedGlobals[key];
  }
  savedGlobals = {};
  domWindow = null;
});

function renderCard(actionLabel?: string): HTMLElement {
  act(() => {
    root?.render(<ToolFileEditCard preview={preview} actionLabel={actionLabel} />);
  });
  return container;
}

describe("ToolFileEditCard 头部动作文案", () => {
  test("传入 actionLabel 时展示「写入文件 · en.md」与行数统计", () => {
    const host = renderCard("写入文件");
    expect(host.querySelector(".app-tool-edit-card__action")?.textContent).toBe("写入文件");
    expect(host.querySelector(".app-tool-edit-card__action-sep")?.textContent).toBe("·");
    expect(host.querySelector(".app-tool-edit-card__filename")?.textContent).toBe("en.md");
    expect(host.querySelector(".app-tool-edit-card__stats")?.textContent).toBe("+2");
  });

  test("未传 actionLabel 时头部只有文件名（外层标题行已给出动作）", () => {
    const host = renderCard();
    expect(host.querySelector(".app-tool-edit-card__action")).toBeNull();
    expect(host.querySelector(".app-tool-edit-card__action-sep")).toBeNull();
    expect(host.querySelector(".app-tool-edit-card__filename")?.textContent).toBe("en.md");
  });
});
