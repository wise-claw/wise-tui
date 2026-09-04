import { useEffect, useRef } from "react";
import { subscribeTerminalExit, subscribeTerminalOutput } from "../services/events";
import { markExecutionEnvironmentDispatchItemExited } from "../stores/executionEnvironmentDispatchStore";
import { normalizeBackgroundScriptOutputText } from "../utils/backgroundScriptOutput";

function isBackgroundScriptTerminalId(terminalId: string): boolean {
  return terminalId.startsWith("assistant-script:") || terminalId.startsWith("workflow-code:");
}

/**
 * 全局订阅 terminal-output / terminal-exit，把 `assistant-script:<id>:<ts>` 终端事件
 * 翻译为 dispatch store 的「已退出」标记与输出文本，让运行面板展示脚本 stdout/stderr。
 */
export function useBackgroundScriptRuntimeSync(): void {
  const outputBuffersRef = useRef(new Map<string, string>());
  const lastChunkRef = useRef(new Map<string, string>());

  useEffect(() => {
    const outputBuffers = outputBuffersRef.current;
    const lastChunkByTerminal = lastChunkRef.current;

    const unlistenOutput = subscribeTerminalOutput((event) => {
      const terminalId = event.terminalId?.trim();
      if (!terminalId || !isBackgroundScriptTerminalId(terminalId)) return;
      const chunk = event.data ?? "";
      if (!chunk) return;
      if (lastChunkByTerminal.get(terminalId) === chunk) return;
      lastChunkByTerminal.set(terminalId, chunk);
      outputBuffers.set(terminalId, (outputBuffers.get(terminalId) ?? "") + chunk);
    });

    const unlistenExit = subscribeTerminalExit((event) => {
      const terminalId = event.terminalId?.trim();
      if (!terminalId || !isBackgroundScriptTerminalId(terminalId)) return;
      const captured = normalizeBackgroundScriptOutputText(outputBuffers.get(terminalId) ?? "");
      markExecutionEnvironmentDispatchItemExited({
        workerSessionId: terminalId,
        exitCode: event.exitCode,
        terminalOutput: captured || undefined,
      });
      outputBuffers.delete(terminalId);
      lastChunkByTerminal.delete(terminalId);
    });

    return () => {
      unlistenOutput();
      unlistenExit();
    };
  }, []);
}
