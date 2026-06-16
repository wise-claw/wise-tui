import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { reasoningPreviewOverflows } from "./reasoningPreviewOverflows";

let domWindow: Window;

beforeEach(() => {
  domWindow = new Window();
  globalThis.document = domWindow.document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis;
});

afterEach(() => {
  domWindow.close();
});

function buildReasoningBody(widthPx: number, text: string): HTMLElement {
  const body = document.createElement("div");
  body.className = "app-message-part-reasoning-collapsible__body";
  body.style.width = `${widthPx}px`;

  const row = document.createElement("div");
  row.className = "app-message-part-reasoning-inline-row";
  row.style.display = "flex";
  row.style.width = `${widthPx}px`;
  row.style.paddingRight = "14px";
  row.style.boxSizing = "border-box";

  const label = document.createElement("span");
  label.className = "app-message-part-reasoning-label";
  label.textContent = "思考过程";
  label.style.flex = "0 0 auto";

  const host = document.createElement("div");
  host.className = "app-markdown-host";
  host.style.flex = "1 1 auto";
  host.style.minWidth = "0";
  host.style.width = `${Math.max(80, widthPx - 90)}px`;
  host.style.overflow = "hidden";
  host.style.display = "inline-flex";

  const markdown = document.createElement("div");
  markdown.className = "app-markdown app-message-part--reasoning-content";
  markdown.style.display = "inline";
  markdown.style.overflow = "hidden";
  markdown.style.textOverflow = "ellipsis";
  markdown.style.whiteSpace = "nowrap";
  markdown.style.fontSize = "11px";
  markdown.style.lineHeight = "1.45";
  markdown.textContent = text;

  host.appendChild(markdown);
  row.appendChild(label);
  row.appendChild(host);
  body.appendChild(row);
  document.body.appendChild(body);

  return body;
}

describe("reasoningPreviewOverflows", () => {
  test("returns false for empty text", () => {
    const body = buildReasoningBody(320, "");
    expect(reasoningPreviewOverflows(body, "   ")).toBe(false);
    body.remove();
  });

  test("returns true when source contains a newline", () => {
    const body = buildReasoningBody(320, "short");
    expect(reasoningPreviewOverflows(body, "line one\nline two")).toBe(true);
    body.remove();
  });

  test("detects logical multi-line source text", () => {
    const body = buildReasoningBody(320, "第一行内容");
    expect(reasoningPreviewOverflows(body, "第一行内容\n\n第二行内容")).toBe(true);
    body.remove();
  });

  test("returns false when short text fits", () => {
    const body = buildReasoningBody(320, "短内容");
    expect(reasoningPreviewOverflows(body, "短内容")).toBe(false);
    body.remove();
  });
});
