import { describe, expect, test } from "bun:test";
import { createLatestTaskQueue } from "./latestTaskQueue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createLatestTaskQueue", () => {
  test("快速连点：只执行最后一次任务，早先的选择不再回写", async () => {
    const queue = createLatestTaskQueue();
    const done: number[] = [];
    for (const seq of [queue.next(), queue.next(), queue.next()]) {
      queue.run(seq, async () => {
        await tick();
        done.push(seq);
      });
    }
    await tick();
    await tick();
    await tick();
    expect(done).toEqual([3]);
  });

  test("依次操作：按提交顺序串行执行，不并发写盘", async () => {
    const queue = createLatestTaskQueue();
    const events: string[] = [];
    const first = queue.next();
    queue.run(first, async () => {
      events.push("first:start");
      await tick();
      events.push("first:end");
    });
    await tick();
    const second = queue.next();
    queue.run(second, async () => {
      events.push("second:start");
      await tick();
      events.push("second:end");
    });
    await tick();
    await tick();
    await tick();
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("任务抛错不会卡住后续任务", async () => {
    const queue = createLatestTaskQueue();
    const failing = queue.next();
    queue.run(failing, async () => {
      throw new Error("写盘失败");
    });
    await tick();
    let ran = false;
    const next = queue.next();
    queue.run(next, async () => {
      ran = true;
    });
    await tick();
    await tick();
    expect(ran).toBe(true);
  });

  test("current 反映最新序号，用于回调内二次校验", () => {
    const queue = createLatestTaskQueue();
    const first = queue.next();
    expect(queue.current()).toBe(first);
    const second = queue.next();
    expect(queue.current()).toBe(second);
    expect(first).not.toBe(second);
  });
});
