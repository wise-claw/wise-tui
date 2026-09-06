/** 将异步发送准备绑定到当前输入区；切换会话后禁止回写或释放新发送的锁。 */
export function createComposerSendScope(generationRef: { current: number }) {
  const generation = generationRef.current;
  const isCurrent = () => generationRef.current === generation;
  return {
    isCurrent,
    async wait<T>(pending: Promise<T>): Promise<T> {
      const result = await pending;
      if (!isCurrent()) throw new Error("发送准备期间会话已切换");
      return result;
    },
    finish(callback: () => void) {
      if (isCurrent()) callback();
    },
  };
}

/** 队列接收或执行启动才算发送成功；显式拒绝交回输入框恢复草稿。 */
export async function requireComposerDispatchAccepted(result: boolean | void | Promise<boolean | void>): Promise<void> {
  if (await result === false) throw new Error("消息未能提交执行，内容已保留，请稍后重试。");
}
