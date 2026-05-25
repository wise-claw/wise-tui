/** 让出主线程一帧，便于先绘制 loading / 关闭弹窗再执行重任务。 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
