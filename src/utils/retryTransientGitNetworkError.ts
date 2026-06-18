/**
 * 识别 `git pull` / `git push` 等远程操作的瞬时网络错误，
 * 在受控次数内退避重试，避免抖动 / DNS / TLS 短时故障直接打断整次同步流程。
 *
 * 典型可重试错误（来自 libcurl / git-pack-protocol）：
 *  - `RPC failed; curl 28 Failed to connect to <host> port 443`
 *  - `fatal: expected flush after ref listing`
 *  - `Could not resolve host` / `Connection reset by peer` / `Connection refused`
 *  - `Operation timed out` / `Couldn't connect to server`
 *  - `early EOF` / `the remote end hung up unexpectedly`
 *  - `SSL_ERROR_SYSCALL` / `gnutls_handshake() failed`
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /RPC failed/i,
  /curl\s*\(?\s*\d+/i,
  /expected flush after ref listing/i,
  /Could not resolve host/i,
  /Couldn't connect to (?:server|host)/i,
  /Connection (?:reset|refused|timed out)/i,
  /Operation timed out/i,
  /Failed to connect to .* port \d+/i,
  /the remote end hung up unexpectedly/i,
  /early EOF/i,
  /SSL_ERROR_SYSCALL/i,
  /gnutls_handshake\(\) failed/i,
  /unexpected disconnect while reading sideband packet/i,
];

export function isTransientGitNetworkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}

export interface RetryTransientOptions {
  /** 总尝试次数（含首次），默认 3。 */
  attempts?: number;
  /** 首次退避（ms），默认 1500，每次乘 backoffFactor。 */
  initialBackoffMs?: number;
  /** 退避倍率，默认 2。 */
  backoffFactor?: number;
  /** 单次退避上限，默认 15s。 */
  maxBackoffMs?: number;
  /** 重试通知（用于上抛进度）。 */
  onRetry?: (info: { attempt: number; nextDelayMs: number; error: unknown }) => void;
  /** 注入 sleep 以便测试。 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 仅当错误被判定为瞬时网络错误时重试；其他错误立即上抛。
 * 拒绝原始错误对象，确保上层 message.error 仍能展示真实原因。
 */
export async function retryTransientGitNetworkError<T>(
  task: () => Promise<T>,
  options?: RetryTransientOptions,
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const backoffFactor = Math.max(1, options?.backoffFactor ?? 2);
  const maxBackoffMs = Math.max(0, options?.maxBackoffMs ?? 15_000);
  const initialBackoffMs = Math.max(0, options?.initialBackoffMs ?? 1_500);
  const sleep = options?.sleep ?? defaultSleep;

  let lastError: unknown;
  let delay = initialBackoffMs;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientGitNetworkError(error)) {
        throw error;
      }
      const nextDelayMs = Math.min(delay, maxBackoffMs);
      options?.onRetry?.({ attempt, nextDelayMs, error });
      if (nextDelayMs > 0) {
        await sleep(nextDelayMs);
      }
      delay = Math.min(delay * backoffFactor, maxBackoffMs);
    }
  }
  throw lastError;
}
