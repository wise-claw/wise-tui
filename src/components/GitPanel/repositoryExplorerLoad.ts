/** Drop stale child-directory IPC after the active repository changes. */
export function shouldApplyExplorerChildLoadResult(args: {
  requestRepositoryPath: string;
  currentRepositoryPath: string;
}): boolean {
  const request = args.requestRepositoryPath.trim();
  const current = args.currentRepositoryPath.trim();
  return request.length > 0 && request === current;
}

/** Drop stale IPC results after repository switch or cancelled scan. */
export function shouldApplyExplorerLoadResult(args: {
  requestGeneration: number;
  currentGeneration: number;
  requestRepositoryPath: string;
  currentRepositoryPath: string;
  cancelled?: boolean;
}): boolean {
  if (args.cancelled) {
    return false;
  }
  if (args.requestGeneration !== args.currentGeneration) {
    return false;
  }
  return args.requestRepositoryPath.trim() === args.currentRepositoryPath.trim();
}
