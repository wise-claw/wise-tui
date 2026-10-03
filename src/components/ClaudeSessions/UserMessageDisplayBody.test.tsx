import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeMessage } from "../../types";
import { UserMessageDisplayBody } from "./UserMessageDisplayBody";

/** 回归测试：用户消息里的 `@文件` 引用按 Codex 桌面端语义高亮，正文保持纯文本。 */

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

function makeUserMessage(text: string): ClaudeMessage {
  return {
    id: 1,
    role: "user",
    content: text,
    parts: [{ type: "text", text }],
    timestamp: Date.now(),
  };
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

function renderMessage(text: string): HTMLElement {
  act(() => {
    root?.render(<UserMessageDisplayBody msg={makeUserMessage(text)} />);
  });
  return container;
}

function refTexts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".app-claude-user-message-at-ref")).map(
    (el) => el.textContent ?? "",
  );
}

describe("UserMessageDisplayBody @引用高亮", () => {
  test("把 @文件引用渲染成高亮 token，正文其余部分保持原文", () => {
    const text = "@phases/00-setup/docs/en.md 翻译为中文，并切换原文件";
    const host = renderMessage(text);
    expect(refTexts(host)).toEqual(["@phases/00-setup/docs/en.md"]);
    expect(host.querySelector(".app-claude-user-message-plain")?.textContent).toBe(text);
  });

  test("多条引用都高亮，且不在正文里插入多余字符", () => {
    const text = "对比 @/repo/a.ts 与 @src/b.ts";
    const host = renderMessage(text);
    expect(refTexts(host)).toEqual(["@/repo/a.ts", "@src/b.ts"]);
    expect(host.querySelector(".app-claude-user-message-plain")?.textContent).toBe(text);
  });

  test("邮箱 / URL 中的 @ 不算引用", () => {
    const text = "联系 a@b.com 或见 https://example.com/@user";
    const host = renderMessage(text);
    expect(refTexts(host)).toEqual([]);
    expect(host.querySelector(".app-claude-user-message-plain")?.textContent).toBe(text);
  });
});
