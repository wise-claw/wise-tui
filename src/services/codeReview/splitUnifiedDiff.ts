/** One file's slice inside a unified multi-file diff. */
export type UnifiedDiffFileChunk = {
  /** Preferred path (b-side, or a-side when deleted). */
  path: string;
  text: string;
};

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Split a unified diff into per-file chunks keyed by `diff --git` headers.
 */
export function splitUnifiedDiff(diffText: string): UnifiedDiffFileChunk[] {
  const text = diffText.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const chunks: UnifiedDiffFileChunk[] = [];
  let currentLines: string[] = [];
  let currentPath = "";

  const flush = () => {
    if (!currentPath) {
      currentLines = [];
      return;
    }
    const body = currentLines.join("\n").replace(/\s+$/g, "");
    chunks.push({
      path: currentPath,
      text: body ? `${body}\n` : "",
    });
    currentLines = [];
    currentPath = "";
  };

  for (const line of lines) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) {
      flush();
      const aPath = normalizePath(match[1] ?? "");
      const bPath = normalizePath(match[2] ?? "");
      currentPath = !bPath || bPath === "/dev/null" ? aPath : bPath;
      currentLines = [line];
      continue;
    }
    if (currentPath) {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

/** Keep only the listed files' hunks (path-normalized). */
export function filterUnifiedDiffToFiles(
  diffText: string,
  paths: readonly string[],
): string {
  const want = new Set(paths.map(normalizePath).filter(Boolean));
  if (want.size === 0) return "";
  const kept = splitUnifiedDiff(diffText).filter((chunk) => want.has(normalizePath(chunk.path)));
  if (kept.length === 0) return "";
  return `${kept.map((chunk) => chunk.text.replace(/\s+$/g, "")).join("\n\n")}\n`;
}

/** Per-file patch fingerprints for incremental focus selection. */
export function fingerprintUnifiedDiffFiles(diffText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of splitUnifiedDiff(diffText)) {
    const path = normalizePath(chunk.path);
    if (!path) continue;
    out[path] = `cff1:${fnv1aHex(chunk.text.replace(/\r\n/g, "\n"))}`;
  }
  return out;
}

/** Files whose per-file patch hash differs from the previous review (or are new). */
export function resolveIncrementalFocusFiles(input: {
  currentFingerprints: Record<string, string>;
  previousFingerprints?: Record<string, string> | null;
  currentPaths: readonly string[];
}): { focusFiles: string[]; unchangedFiles: string[] } {
  const prev = input.previousFingerprints ?? {};
  const hasPrevious = Object.keys(prev).length > 0;
  const focusFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const paths = [
    ...new Set(input.currentPaths.map(normalizePath).filter(Boolean)),
  ].sort();

  for (const path of paths) {
    const currentHash = input.currentFingerprints[path] ?? "";
    if (!hasPrevious || !prev[path] || prev[path] !== currentHash) {
      focusFiles.push(path);
    } else {
      unchangedFiles.push(path);
    }
  }
  return { focusFiles, unchangedFiles };
}
