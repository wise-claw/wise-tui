import { useEffect } from "react";
import { subscribeTerminalExit } from "../services/events";
import { markExecutionEnvironmentDispatchItemExited } from "../stores/executionEnvironmentDispatchStore";

/**
 * 全局订阅 terminal-exit，把 `assistant-script:<id>:<ts>` 终端退出事件
 * 翻译为 dispatch store 的「已退出」标记，让运行面板自动从「运行中」
 * 切到「已完成/失败」并展示结局（exit code）。
 *
 * 设计要点：
 * - 仅过滤 `assistant-script:` 前缀的 terminalId，避免与 user / agent 终端混淆。
 * - 复用 `markExecutionEnvironmentDispatchItemExited`（store 内部按 workerSessionId
 *   查找并更新 previewText/updatedAt/exitCode），无需在这里维护反向映射表。
 * - 这里只挂一个全局订阅即可；组件层（AppImpl）useEffect 调用一次。
 */
export function useBackgroundScriptRuntimeSync(): void {
  useEffect(() => {
    const unlisten = subscribeTerminalExit((event) => {
      const terminalId = event.terminalId?.trim();
      if (!terminalId || !terminalId.startsWith("assistant-script:")) return;
      markExecutionEnvironmentDispatchItemExited({
        workerSessionId: terminalId,
        exitCode: event.exitCode,
      });
    });
    return unlisten;
  }, []);
}