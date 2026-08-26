import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TurnFileChangeEntry } from "../../utils/turnFileChangeSummary";
import { TurnFilesChangedSummaryCard } from "./TurnFilesChangedSummaryCard";

/** 回归测试：文件变更总结卡在文件数超过上限时默认折叠，可展开/收起。 */

const OVERRIDDEN_GLOBAL_KEYS = [
  "window", "document", "HTMLElement", "HTMLDivElement", "HTMLUListElement",
  "HTMLLIElement", "HTMLButtonElement", "HTMLSpanElement", "Element", "Node",
  "Event", "MouseEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT",
] as const;

let domWindow: Window | null = null;
let container: HTMLElement;
let root: Root | null = null;
let savedGlobals: Record<string, unknown> = {};

function makeFiles(count: number): TurnFileChangeEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    filePath: `/repo/src/file-${i}.ts`,
    fileName: `file-${i}.ts`,
    addedLineCount: i + 1,
    removedLineCount: i % 2,
  }));
}

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

function renderCard(files: readonly TurnFileChangeEntry[]) {
  act(() => {
    root?.render(<TurnFilesChangedSummaryCard files={files} />);
  });
  return container;
}

function fileRows(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".app-turn-files-changed__filename")).map(
    (el) => el.textContent ?? "",
  );
}

describe("TurnFilesChangedSummaryCard 折叠展示", () => {
  test("文件数超过上限时默认只展示前 8 个，并给出展开入口", () => {
    const host = renderCard(makeFiles(12));
    const rows = fileRows(host);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toBe("file-0.ts");
    expect(rows[7]).toBe("file-7.ts");

    const toggle = host.querySelector<HTMLButtonElement>(".app-turn-files-changed__toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain("展开全部（共 12 个文件）");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("另有 4 个文件未展示");
    expect(host.textContent).toContain("12 个文件已修改");
  });

  test("点击展开后展示全部文件，可再收起", () => {
    const host = renderCard(makeFiles(10));
    const toggle = host.querySelector<HTMLButtonElement>(".app-turn-files-changed__toggle")!;

    act(() => toggle.click());
    expect(fileRows(host)).toHaveLength(10);
    expect(host.querySelector(".app-turn-files-changed__toggle")?.textContent).toContain("收起");
    expect(host.textContent).not.toContain("未展示");

    act(() => host.querySelector<HTMLButtonElement>(".app-turn-files-changed__toggle")!.click());
    expect(fileRows(host)).toHaveLength(8);
    expect(host.querySelector(".app-turn-files-changed__toggle")?.textContent).toContain(
      "展开全部（共 10 个文件）",
    );
  });

  test("文件数未超上限时不出现折叠入口", () => {
    const host = renderCard(makeFiles(3));
    expect(fileRows(host)).toHaveLength(3);
    expect(host.querySelector(".app-turn-files-changed__toggle")).toBeNull();
    expect(host.textContent).not.toContain("未展示");
  });

  test("空列表不渲染卡片", () => {
    const host = renderCard([]);
    expect(host.querySelector(".app-turn-files-changed")).toBeNull();
  });
});
