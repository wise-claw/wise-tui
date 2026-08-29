/**
 * 「串行执行 + 只保留最后一次操作」的小队列。
 *
 * 用于模型 / 档案切换这类需要写盘的用户操作：写盘任务必须串行（并发读改写
 * `settings.json` / `auth.json` / `config.toml` 会互相覆盖），且快速连点时早先那次
 * 返回后不能再回写 UI 状态，否则选择会被弹回上一次。
 */
export interface LatestTaskQueue {
  /** 登记一次新操作并返回它的序号。 */
  next(): number;
  /** 当前最新操作序号。 */
  current(): number;
  /** `seq` 仍是最新操作时串行执行 `task`；否则直接丢弃。 */
  run(seq: number, task: () => Promise<void>): void;
}

export function createLatestTaskQueue(): LatestTaskQueue {
  let seq = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    next: () => ++seq,
    current: () => seq,
    run: (taskSeq, task) => {
      const run = async () => {
        // 排队期间又发生了更晚的选择：这次写盘已无意义，直接跳过。
        if (taskSeq !== seq) return;
        try {
          await task();
        } catch {
          /* 写盘失败时保留用户在 UI 上的选择，不打断连续切换 */
        }
      };
      chain = chain.then(run, run);
    },
  };
}
