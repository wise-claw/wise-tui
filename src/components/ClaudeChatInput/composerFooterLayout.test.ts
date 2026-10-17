import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { updateComposerFooterLayout } from "./composerFooterLayout";

test("multi-pane labels use content demand and recover after expanding or changing models", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const update = () => updateComposerFooterLayout(root as unknown as HTMLElement);
  // Semi mounts the editor/footer after the composer itself.
  update();
  root.innerHTML = '<div class="semi-aiChatInput-footer" style="column-gap:6px;padding:0 8px"><div class="app-claude-semi-footer-toolbar-left"></div><div class="app-claude-semi-footer-toolbar-right"></div></div>';
  const footer = root.firstElementChild!;
  let width = 620;
  let actionsWidth = 300;
  Object.defineProperty(footer, "clientWidth", { get: () => width });
  const [left, right] = Array.from(footer.children);
  left!.getBoundingClientRect = () => ({ width: 190 }) as DOMRect;
  right!.getBoundingClientRect = () => {
    // Always measure expanded labels, even when recovering from compact mode.
    expect(root.hasAttribute("data-footer-labels-compact")).toBe(false);
    expect(root.hasAttribute("data-footer-labels-measuring")).toBe(true);
    return { width: actionsWidth } as DOMRect;
  };
  update();
  expect(root.hasAttribute("data-footer-labels-compact")).toBe(false);
  width = 420;
  update();
  expect(root.hasAttribute("data-footer-labels-compact")).toBe(true);
  width = 620;
  update();
  expect(root.hasAttribute("data-footer-labels-compact")).toBe(false);
  actionsWidth = 450;
  update();
  expect(root.hasAttribute("data-footer-labels-compact")).toBe(true);
  actionsWidth = 300;
  update();
  expect(root.hasAttribute("data-footer-labels-compact")).toBe(false);
  expect(root.hasAttribute("data-footer-labels-measuring")).toBe(false);
  window.happyDOM.abort();
});
