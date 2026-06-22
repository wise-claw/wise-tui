import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";
import type { CommandPaletteSearchMode } from "./index";

export interface CommandPaletteComparableProps {
  open: boolean;
  repositoryPath?: string | null;
  searchMode: CommandPaletteSearchMode;
  /** 文件树右键"在此搜索"预置的搜索范围（仓库相对目录）；undefined=整个仓库。 */
  initialScopeDir?: string;
  onClose: () => void;
  onSearchModeChange: (mode: CommandPaletteSearchMode) => void;
  onOpenInApp: (relativePath: string, options?: { line?: number | null }) => void;
}

/** 搜索面板关闭时跳过回调比较，避免主布局重渲染触发空跑。 */
export function commandPalettePropsEqual(
  prev: CommandPaletteComparableProps,
  next: CommandPaletteComparableProps,
): boolean {
  if (prev.open !== next.open) return false;
  if (prev.repositoryPath !== next.repositoryPath) return false;
  if (prev.searchMode !== next.searchMode) return false;
  if (prev.initialScopeDir !== next.initialScopeDir) return false;
  if (!prev.open && !next.open) return true;
  return arePropsEqualSkipping(prev, next, { skipFunctions: true });
}
