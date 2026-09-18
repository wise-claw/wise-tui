import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildRepositoryCanvasDocument, isRepositoryCanvasPath } from "./repositoryCanvas";

describe("repository Canvas documents", () => {
  test("recognizes browser artifacts without treating source modules as runnable pages", () => {
    for (const path of ["output/demo.html", "demo.HTM", "diagram.SVG", "产品方案.md", "design.MARKDOWN"]) {
      expect(isRepositoryCanvasPath(path)).toBe(true);
    }
    for (const path of ["app.tsx", "demo.html.ts", "image.png"]) {
      expect(isRepositoryCanvasPath(path)).toBe(false);
    }
  });

  test("keeps full documents and scripts behind the first CSP and fixed base", () => {
    const win = new Window({ settings: { enableJavaScriptEvaluation: false } });
    const source = '<!doctype html><html><head><base href="http://localhost:16088/"><style>body{color:red}</style></head><body><button>运行</button><script>window.example=1</script></body></html>';
    win.document.write(buildRepositoryCanvasDocument(source));
    expect(win.document.querySelector("button")?.textContent).toBe("运行");
    expect(win.document.querySelector("script")?.textContent).toBe("window.example=1");
    expect(win.document.querySelector("base")?.href).toBe("https://canvas.invalid/");
    const policy = win.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("unsafe-eval");
    win.happyDOM.abort();
  });
});
