/** How a directory row click should behave (pure — testable). */
export type RepositoryDirToggleIntent = "collapse" | "expand-and-load" | "load-children-only";

export function normalizeRepositoryDirPath(dirPath: string): string {
  return dirPath.trim();
}

/**
 * Session may restore `expanded` without cached children — load only, do not collapse.
 */
export function resolveRepositoryDirToggleIntent(args: {
  isExpanded: boolean;
  childrenLoaded: boolean;
}): RepositoryDirToggleIntent {
  if (args.isExpanded && !args.childrenLoaded) {
    return "load-children-only";
  }
  if (!args.isExpanded) {
    return "expand-and-load";
  }
  return "collapse";
}
