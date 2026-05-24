import type { SddMode } from "../types";

export type RepositorySddStackBadgeVariant = "wise" | "owned";

export interface RepositorySddStackBadgeMeta {
  title: string;
  variant: RepositorySddStackBadgeVariant;
}

/** 侧栏仓库行：仅展示已显式写入的 SDD 模式（非 auto / off）。 */
export function repositorySddStackBadgeMeta(
  sddMode: SddMode | undefined,
): RepositorySddStackBadgeMeta | null {
  switch (sddMode) {
    case "wise_trellis":
      return {
        title: "内置 Wise Trellis 已配置",
        variant: "wise",
      };
    case "project_owned":
      return {
        title: "已配置 SDD 能力栈",
        variant: "owned",
      };
    default:
      return null;
  }
}
