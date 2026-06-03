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
  return args.requestRepositoryPath === args.currentRepositoryPath;
}
