export function expandTouchAffectsDir(nodePath: string, toggledPath: string): boolean {
  if (!toggledPath) {
    return false;
  }
  return toggledPath === nodePath || toggledPath.startsWith(`${nodePath}/`);
}
