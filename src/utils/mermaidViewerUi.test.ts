import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mountRenderedMermaidDiagram } from "./mermaidViewerUi";
import { handleMermaidZoomAction } from "./mermaidDiagramViewport";

describe("mountRenderedMermaidDiagram toolbar actions", () => {
  let domWindow: Window;

  beforeEach(() => {
    domWindow = new Window();
    globalThis.document = domWindow.document as unknown as Document;
    globalThis.window = domWindow as unknown as Window & typeof globalThis;
    globalThis.getComputedStyle = domWindow.getComputedStyle.bind(domWindow);
  });

  afterEach(() => {
    domWindow.close();
  });

  test("binds zoom controls without a markdown host container", () => {
    const block = document.createElement("div");
    block.className = "app-markdown-mermaid";
    document.body.appendChild(block);

    mountRenderedMermaidDiagram(
      block,
      '<svg viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100"/></svg>',
    );

    const zoomIn = block.querySelector<HTMLButtonElement>('[data-mermaid-action="zoom-in"]');
    expect(zoomIn).not.toBeNull();
    expect(block.getAttribute("data-mermaid-zoom")).toBe("1.000");

    zoomIn?.click();
    expect(handleMermaidZoomAction(block, "zoom-in")).toBe(true);
    expect(Number.parseFloat(block.getAttribute("data-mermaid-zoom") ?? "1")).toBeGreaterThan(1);
  });
});
