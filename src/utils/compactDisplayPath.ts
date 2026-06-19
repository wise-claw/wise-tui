/** Collapse common home prefixes for compact UI path lines. */
export function compactDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  for (const pattern of [/^\/Users\/[^/]+(\/.*)?$/, /^\/home\/[^/]+(\/.*)?$/]) {
    const match = normalized.match(pattern);
    if (match) return `~${match[1] ?? ""}`;
  }
  return normalized;
}
