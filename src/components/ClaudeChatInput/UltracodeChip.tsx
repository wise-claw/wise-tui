import { HoverHint } from "../shared/HoverHint";

interface UltracodeChipProps {
  /**
   * 当前会话 ultracode 是否实际激活（含 per-session override 与全局兜底合并）。
   * `true` 时渲染紫罗兰色 chip，`false` 时不渲染（避免冗余噪音）。
   */
  active: boolean;
  /**
   * 是否显式覆盖了全局开关（`true` = 本会话强制开；`false` = 本会话强制关）。
   * 用于区分"跟随全局"与"本标签临时"两种来源的视觉。
   */
  hasTabOverride: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  className?: string;
}

const LABEL = "ultracode";

const TOOLTIP_OVERRIDE = "本会话已开启 ultracode（OMC 多代理编排模式）。点击可关闭。";
const TOOLTIP_FOLLOW = "跟随全局设置已开启 ultracode。点击可为本会话临时关闭。";

/**
 * Composer header chip：per-session ultracode 开启时显示，单击立即关闭。
 *
 * 与 `ClaudeConnectionKindChip` 的差异：
 * - 无下拉菜单（boolean toggle 单一选项，不需要二级选择）；
 * - 仅在激活态渲染，非激活态直接 return null，避免占用 composer 顶部空间。
 */
export function UltracodeChip({
  active,
  hasTabOverride,
  onToggle,
  disabled = false,
  className,
}: UltracodeChipProps) {
  if (!active) return null;
  const interactive = Boolean(onToggle) && !disabled;
  const tooltip = hasTabOverride ? TOOLTIP_OVERRIDE : TOOLTIP_FOLLOW;

  const chip = (
    <span
      className={`app-ultracode-chip${interactive ? " app-ultracode-chip--interactive" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label="ultracode 模式（OMC 多代理编排）"
      aria-pressed={true}
    >
      {LABEL}
    </span>
  );

  if (!interactive) {
    return (
      <HoverHint title={tooltip} placement="top">
        {chip}
      </HoverHint>
    );
  }

  return (
    <HoverHint title={tooltip} placement="top">
      <button
        type="button"
        className="app-ultracode-chip-btn"
        onClick={onToggle}
        aria-label="关闭 ultracode 模式"
      >
        {chip}
      </button>
    </HoverHint>
  );
}