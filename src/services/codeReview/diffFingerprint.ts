/**
 * Stable fingerprint for a reviewable diff (Cursor-style skip when unchanged).
 * Not cryptographic — only used for local reuse matching.
 */
export function fingerprintCodeReviewDiff(input: {
  scope: string;
  baseRef?: string | null;
  filePaths: readonly string[];
  diffText: string;
}): string {
  const files = [...input.filePaths]
    .map((path) => path.replace(/\\/g, "/"))
    .sort()
    .join("\n");
  const material = [
    input.scope.trim(),
    (input.baseRef ?? "").trim(),
    files,
    input.diffText.replace(/\r\n/g, "\n"),
  ].join("\n--\n");
  return `crfp1:${fnv1aHex(material)}`;
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
