/**
 * 批量写入终端输出，避免高频 PTY 流把渲染压垮（借鉴 OpenCode terminalWriter）。
 */
const TERMINAL_WRITER_MAX_PENDING_CHARS = 512 * 1024;

export function terminalWriter(
  write: (data: string, done?: () => void) => void,
): {
  push: (data: string) => void;
  flush: (done?: () => void) => void;
  clear: () => void;
} {
  let pending = "";
  let flushing = false;
  let flushDone: (() => void) | undefined;

  const drain = () => {
    if (!pending) {
      flushing = false;
      flushDone?.();
      flushDone = undefined;
      return;
    }
    const chunk = pending;
    pending = "";
    try {
      write(chunk, () => {
        if (pending) {
          drain();
          return;
        }
        flushing = false;
        flushDone?.();
        flushDone = undefined;
      });
    } catch {
      flushing = false;
      flushDone?.();
      flushDone = undefined;
    }
  };

  return {
    push(data: string) {
      if (!data) return;
      pending += data;
      if (pending.length > TERMINAL_WRITER_MAX_PENDING_CHARS) {
        pending = pending.slice(-TERMINAL_WRITER_MAX_PENDING_CHARS / 2);
      }
    },
    flush(done?: () => void) {
      if (done) {
        flushDone = done;
      }
      if (flushing) return;
      if (!pending) {
        flushDone?.();
        flushDone = undefined;
        return;
      }
      flushing = true;
      drain();
    },
    clear() {
      pending = "";
    },
  };
}
