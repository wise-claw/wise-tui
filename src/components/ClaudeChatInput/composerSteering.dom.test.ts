import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { handleComposerTabKeyDown } from "./composerSteering";

test("Tab from editor sends even when WebView activeElement is body; rebuilt editors work", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const sends: string[] = [];
  root.addEventListener("keydown", (event) => handleComposerTabKeyDown(event as unknown as KeyboardEvent, {
    root: root as unknown as HTMLElement, shell: root as unknown as HTMLElement,
    engine: "codex-rpc", busy: false, completing: false, canSteer: true, canSend: true,
    send: (mode) => sends.push(mode), focusEditor: () => {},
  }), true);
  for (let i = 0; i < 2; i++) {
    root.innerHTML = '<div class="ProseMirror" contenteditable="true"><p>你好1</p></div><button>添加</button>';
    expect(window.document.activeElement).toBe(window.document.body);
    const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    root.querySelector("p")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.document.activeElement).toBe(window.document.body);
  }
  expect(sends).toEqual(["send", "send"]);
  window.happyDOM.abort();
});

test("Tab on footer returns to editor; empty input cannot move focus or send", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = '<div class="ProseMirror" contenteditable="true"></div><button>添加</button>';
  window.document.body.append(root);
  let focused = 0;
  let sent = 0;
  root.addEventListener("keydown", (event) => handleComposerTabKeyDown(event as unknown as KeyboardEvent, {
    root: root as unknown as HTMLElement, shell: root as unknown as HTMLElement,
    engine: "codex-rpc", busy: false, completing: false, canSteer: true, canSend: false,
    send: () => sent++, focusEditor: () => focused++,
  }), true);
  for (const target of [root.querySelector("button")!, root.querySelector(".ProseMirror")!]) {
    const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(focused).toBe(1);
  expect(sent).toBe(0);
  window.happyDOM.abort();
});
