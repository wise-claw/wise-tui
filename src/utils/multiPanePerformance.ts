import {
  CLAUDE_DISK_JSONL_TAIL_LINES_LAZY,
  IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX,
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
  IN_MEMORY_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import {
  CHAT_MESSAGE_LIST_COMPANION_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_COMPANION_LOAD_STEP,
} from "../constants/claudeMessageList";
import type { PaneCount } from "../constants/mainLayoutWidths";

/** 多屏离屏窗格延迟卸载（ms），避免快速滚动时反复挂载完整 ClaudeChat。 */
export const MULTI_PANE_LAZY_UNMOUNT_MS = 2400;

/** 超过 2 屏时启用视口 lazy 挂载。 */
export function shouldLazyMountMultiPaneExtraCells(paneCount: number): boolean {
  return paneCount > 2;
}

/** 4+ 屏离屏运行窗格使用精简壳层，避免挂载完整 ClaudeChat。 */
export function shouldUseOffscreenRunningShell(paneCount: number): boolean {
  return paneCount > 2;
}

export interface CompanionPaneRenderInput {
  paneCount: PaneCount;
  /** 窗格是否已绑定执行会话。 */
  hasSession: boolean;
  /** 会话处于 running / connecting（必须保持挂载）。 */
  isRunning: boolean;
  /** 该伴生窗格是否即为当前活动会话（一般为 false）。 */
  isActivePane: boolean;
  /** 窗格是否在视口内（含 rootMargin）。 */
  inView: boolean;
  /** 懒挂载状态机是否已挂载该窗格。 */
  mounted: boolean;
  /** 是否有待处理的提问请求（有则需用完整聊天回答）。 */
  hasQuestionRequest: boolean;
}

export interface CompanionPaneRenderDecision {
  /** 用离屏精简壳替代完整 ClaudeChat（仅离屏且运行中的窗格）。 */
  useOffscreenRunningShell: boolean;
  /** 推迟挂载消息列表 / 输入框等重型子树（仅离屏且运行中的窗格）。 */
  deferHeavySubtree: boolean;
}

/**
 * 伴生窗格渲染降级决策。核心不变量：**在视口内的窗格永远渲染完整 ClaudeChat**
 * （消息列表 + 输入框 + 提问 dock），无论是否在运行；仅对真正离屏且仍在运行的窗格
 * 才降级为精简壳 / 推迟重型子树。这样 6/8 屏仍能节省离屏内存，同时修复「3+ 屏在屏窗格
 * 发消息后看不到消息列表与输入框」的问题。
 */
export function resolveCompanionPaneRenderDecision(
  input: CompanionPaneRenderInput,
): CompanionPaneRenderDecision {
  const lazy = shouldLazyMountMultiPaneExtraCells(input.paneCount);
  const offscreenRunning =
    lazy && input.hasSession && input.isRunning && !input.isActivePane && !input.inView;
  return {
    useOffscreenRunningShell:
      offscreenRunning &&
      shouldUseOffscreenRunningShell(input.paneCount) &&
      !input.hasQuestionRequest,
    deferHeavySubtree: lazy && input.mounted && input.isRunning && !input.inView,
  };
}

/** 伴生窗格按数量分摊全局消息预算，避免 6/8 屏时内存线性膨胀。 */
export function resolveCompanionSessionMessagesMax(companionCount: number): number {
  if (companionCount <= 0) return IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX;
  const shareable = Math.max(24, IN_MEMORY_GLOBAL_MESSAGES_BUDGET - IN_MEMORY_SESSION_MESSAGES_MAX);
  return Math.max(
    6,
    Math.min(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX, Math.floor(shareable / companionCount)),
  );
}

/** 多伴生会话时适度抬高全局预算上限。 */
export function resolveGlobalMessagesBudget(companionCount: number): number {
  const extra = Math.max(0, companionCount - 1) * 8;
  return Math.min(256, IN_MEMORY_GLOBAL_MESSAGES_BUDGET + extra);
}

/** 伴生窗格磁盘懒加载行数：窗格越多，单次读入越少。 */
export function resolveCompanionDiskTranscriptTailLines(companionCount: number): number {
  if (companionCount <= 1) return CLAUDE_DISK_JSONL_TAIL_LINES_LAZY;
  return Math.max(72, Math.floor(CLAUDE_DISK_JSONL_TAIL_LINES_LAZY / Math.min(companionCount, 5)));
}

/** 伴生窗格消息列表尾部窗口：6/8 屏进一步缩小 DOM 树。 */
export function resolveCompanionMessageListWindow(paneCount: PaneCount): {
  initialVisible: number;
  loadStep: number;
} {
  if (paneCount <= 4) {
    return {
      initialVisible: CHAT_MESSAGE_LIST_COMPANION_INITIAL_VISIBLE,
      loadStep: CHAT_MESSAGE_LIST_COMPANION_LOAD_STEP,
    };
  }
  if (paneCount <= 6) {
    return { initialVisible: 18, loadStep: 12 };
  }
  return { initialVisible: 14, loadStep: 10 };
}

/** 多伴生磁盘懒加载错峰间隔（ms）。 */
export function resolveCompanionDiskLoadStaggerMs(companionIndex: number): number {
  return 1800 + companionIndex * 900;
}
