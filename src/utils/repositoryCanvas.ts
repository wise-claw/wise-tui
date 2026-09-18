import { isCanvasDocumentPath } from "./canvasArtifacts";

/** Canvas accepts browser-native artifacts; JSX/TSX still require the project's build. */
export function isRepositoryCanvasPath(path: string): boolean {
  return /\.(html?|svg)$/i.test(path) || isCanvasDocumentPath(path);
}

/** Opaque-origin iframe plus CSP: artifact scripts never share Wise's origin or IPC. */
export function buildRepositoryCanvasDocument(content: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline' data: https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src https:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri https://canvas.invalid";
  // An explicit base prevents relative URLs from resolving against the workbench URL.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><base href="https://canvas.invalid/"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${content}</body></html>`;
}
