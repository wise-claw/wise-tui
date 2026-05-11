/** 拖拽添加附件调试日志；控制台过滤 `[wise:claude-drop]` */
export function logClaudeDrop(phase: string, detail?: Record<string, unknown>): void {
  if (detail !== undefined) {
    console.info(`[wise:claude-drop] ${phase}`, detail);
  } else {
    console.info(`[wise:claude-drop] ${phase}`);
  }
}
