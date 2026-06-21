import { ThunderboltFilled } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";
import { useEffectiveAutoApproveMode } from "../../hooks/useEffectiveAutoApproveMode";

interface AutoApproveBadgeProps {
  /** 当前会话绑定的仓库路径；无仓时传 null/undefined 仅落到全局默认。 */
  repositoryPath?: string | null;
}

const TONE: Record<"edits" | "all", { color: string; label: string; tooltip: string }> = {
  edits: {
    color: "gold",
    label: "自动 · 仅编辑",
    tooltip:
      "当前会话已开启自动批准（仅文件编辑与计划批准）。Edit / Write / MultiEdit / NotebookEdit 与 ExitPlanMode 会被自动通过；其它工具与提问仍需人工确认。",
  },
  all: {
    color: "volcano",
    label: "自动 · 全部",
    tooltip:
      "当前会话已开启完全自动批准。Permission 自动 allow，AskUserQuestion 自动选首项（multiSelect 全选）。仅建议在受信、可回滚的工作树中使用。",
  },
};

/**
 * Composer 底栏的自动批准状态徽标。
 *
 * 决策与 useClaudeSessions 的 auto-approve 通路同源（`resolveEffectiveAutoApproveMode`），
 * 因此用户从「工作台配置 → 自动批准」改动设置后，徽标会即时更新。
 *
 * `off` 与未解析（`null`）状态下不渲染——保持底栏视觉安静。
 */
export function AutoApproveBadge({ repositoryPath }: AutoApproveBadgeProps) {
  const mode = useEffectiveAutoApproveMode(repositoryPath ?? null);
  if (mode !== "edits" && mode !== "all") return null;
  const tone = TONE[mode];
  return (
    <Tooltip title={tone.tooltip} placement="top">
      <Tag
        color={tone.color}
        icon={<ThunderboltFilled />}
        style={{ marginLeft: 8, marginRight: 0 }}
        data-auto-approve-mode={mode}
      >
        {tone.label}
      </Tag>
    </Tooltip>
  );
}
