/** Avoid restoring hundreds of expanded paths (no auto child-load on mount). */
export const MAX_RESTORED_EXPLORER_EXPANDED_DIRS = 48;

function isSafeExplorerRelativePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return false;
  }
  if (trimmed.includes("..")) {
    return false;
  }
  return true;
}

/**
 * Cap and sanitize session-restored expand set. Keeps shallow paths first when truncating.
 */
export function sanitizeExplorerExpandedDirsForRestore(dirs: ReadonlySet<string>): Set<string> {
  const safe = [...dirs].filter(isSafeExplorerRelativePath);
  safe.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return new Set(safe.slice(0, MAX_RESTORED_EXPLORER_EXPANDED_DIRS));
}
