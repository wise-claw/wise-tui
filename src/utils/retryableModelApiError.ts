/** 可触发模型档案自动切换的 API / 限流类错误（Composer 与 Mission 共用）。 */
const RETRYABLE_MODEL_API_ERROR_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /500|502|503|504/i,
  /overload/i,
  /service.?unavailable/i,
  /too many requests/i,
  /try again/i,
  /timeout|timed.?out/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
  /connection.*error/i,
  /internal.*server.*error/i,
  /quota/i,
  /capacity/i,
];

export function isRetryableModelApiError(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return RETRYABLE_MODEL_API_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}
