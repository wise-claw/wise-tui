import { describe, expect, test } from "bun:test";
import { terminalWriter } from "./terminalWriter";

describe("terminalWriter", () => {
  test("flushes queued chunks in order", async () => {
    const writes: string[] = [];
    const writer = terminalWriter((data, done) => {
      writes.push(data);
      done?.();
    });

    writer.push("alpha");
    writer.push("beta");
    await new Promise<void>((resolve) => writer.flush(resolve));

    expect(writes).toEqual(["alphabeta"]);
  });

  test("coalesces multiple pushes before flush", async () => {
    const writes: string[] = [];
    const writer = terminalWriter((data, done) => {
      writes.push(data);
      done?.();
    });

    writer.push("a");
    writer.push("b");
    writer.push("c");
    await new Promise<void>((resolve) => writer.flush(resolve));

    expect(writes).toEqual(["abc"]);
  });
});
