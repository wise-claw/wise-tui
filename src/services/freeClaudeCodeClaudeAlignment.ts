import { Modal } from "antd";
import {
  applyFreeClaudeCodeClaudeSettings,
  getFreeClaudeCodeStatus,
  sanitizeClaudeCredentialsForFcc,
  type FreeClaudeCodeStatus,
} from "./freeClaudeCode";

export type FccClaudeAlignmentResult = {
  status: FreeClaudeCodeStatus;
  applied: boolean;
  needsGuide: boolean;
};

/** 代理已运行且 settings.json 未对齐时，尝试写入 FCC 连接配置。 */
export async function tryReconcileFccClaudeSettings(
  st: FreeClaudeCodeStatus,
): Promise<FccClaudeAlignmentResult> {
  if (!st.serverRunning || st.claudeSettingsAligned) {
    return { status: st, applied: false, needsGuide: false };
  }

  if (!st.authToken?.trim()) {
    return { status: st, applied: false, needsGuide: true };
  }

  try {
    await applyFreeClaudeCodeClaudeSettings();
    await sanitizeClaudeCredentialsForFcc();
    const refreshed = await getFreeClaudeCodeStatus();
    if (refreshed.claudeSettingsAligned) {
      return { status: refreshed, applied: true, needsGuide: false };
    }
    return { status: refreshed, applied: false, needsGuide: true };
  } catch {
    return { status: st, applied: false, needsGuide: true };
  }
}

function buildFccClaudeSettingsGuideText(st: FreeClaudeCodeStatus): string {
  const lines = [
    `Claude Code 的 settings.json 尚未指向本机 FCC 代理（${st.proxyBaseUrl}）。`,
    "",
    "请按以下步骤完成配置：",
  ];
  if (!st.authToken?.trim()) {
    lines.push(
      "1. 在 Admin UI 配置 Provider Key，确保 ~/.fcc/.env 中有 ANTHROPIC_AUTH_TOKEN。",
      "2. 点击面板中的「同步 Claude 设置」，写入 ANTHROPIC_BASE_URL 与认证。",
      "3. 新建或重启 Claude 会话使配置生效。",
    );
  } else {
    lines.push(
      "1. 点击面板中的「同步 Claude 设置」，将连接写入 ~/.claude/settings.json。",
      "2. 新建或重启 Claude 会话使配置生效。",
    );
  }
  return lines.join("\n");
}

/** Claude Code 尚未指向 FCC 时弹出配置引导。 */
export function showFccClaudeSettingsGuideModal(st: FreeClaudeCodeStatus): void {
  Modal.info({
    title: "Claude Code 尚未指向 FCC",
    width: 480,
    okText: "知道了",
    content: buildFccClaudeSettingsGuideText(st),
  });
}
