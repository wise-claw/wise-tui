/**
 * 将 Claude / 模型 API 返回的原始英文错误文本转义为友好中文，
 * 末尾附原文（截断）便于反馈/排查；未识别则原样返回。
 *
 * 仅用于展示层格式化（会话系统消息、轮次失败摘要、直连批量预览）。
 * 重试 / 限流判定（isRetryableModelApiError 等）仍读原始文本，不经此函数，
 * 故自动模型档案切换 / 失败判定不受影响。
 */

export interface ClaudeErrorHumanizeRule {
  pattern: RegExp;
  message: string;
}

/**
 * 已知 API / 网络错误模式 -> 友好中文。按优先级排列，先匹配先返回。
 * 文字模式排在纯状态码之前，避免码字误伤的同时保留码字兜底。
 */
export const HUMANIZE_CLAUDE_ERROR_PATTERNS: readonly ClaudeErrorHumanizeRule[] = [
  { pattern: /overload/i, message: "服务繁忙，请稍后重试" },
  { pattern: /\b529\b/, message: "服务繁忙，请稍后重试" },
  { pattern: /rate.?limit/i, message: "请求频率超限，请稍后重试" },
  { pattern: /too many requests/i, message: "请求频率超限，请稍后重试" },
  { pattern: /\b429\b/, message: "请求频率超限，请稍后重试" },
  { pattern: /billing|insufficient.*balance|quota/i, message: "账户额度不足或计费异常" },
  { pattern: /\b402\b/, message: "账户额度不足或计费异常" },
  { pattern: /authentication_failed|unauthorized|invalid.*api.?key/i, message: "鉴权失败，请检查 API Key" },
  { pattern: /\b401\b/, message: "鉴权失败，请检查 API Key" },
  { pattern: /permission_denied|forbidden/i, message: "无权限访问" },
  { pattern: /\b403\b/, message: "无权限访问" },
  { pattern: /invalid_request_error|bad.?request/i, message: "请求参数有误" },
  { pattern: /\b400\b/, message: "请求参数有误" },
  { pattern: /not.?found/i, message: "资源不存在" },
  { pattern: /\b404\b/, message: "资源不存在" },
  { pattern: /service.?unavailable/i, message: "服务暂不可用，请稍后重试" },
  { pattern: /\b503\b/, message: "服务暂不可用，请稍后重试" },
  { pattern: /bad.?gateway/i, message: "网关异常，请稍后重试" },
  { pattern: /\b502\b/, message: "网关异常，请稍后重试" },
  { pattern: /gateway.?timeout/i, message: "网关超时，请稍后重试" },
  { pattern: /\b504\b/, message: "网关超时，请稍后重试" },
  { pattern: /internal.?server.?error|server_error/i, message: "服务端异常，请稍后重试" },
  { pattern: /\b500\b/, message: "服务端异常，请稍后重试" },
  { pattern: /timeout|timed.?out/i, message: "请求超时，请稍后重试" },
  {
    pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection.*(reset|refused)|network error/i,
    message: "网络连接异常，请检查网络后重试",
  },
];

/** 原文附在友好中文末尾时的最大长度，超出截断加省略号，避免长 stacktrace 污染展示。 */
const RAW_APPEND_MAX_CHARS = 80;

function truncateRawForAppend(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length <= RAW_APPEND_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, RAW_APPEND_MAX_CHARS)}…`;
}

/**
 * 转义 Claude / API 原始错误文本为友好中文。
 * 命中已知模式返回 `${中文}（${原文截断}）`；未命中返回原文。
 */
export function humanizeClaudeError(raw: string): string {
  const text = raw ?? "";
  if (!text.trim()) return raw;
  const rule = HUMANIZE_CLAUDE_ERROR_PATTERNS.find((r) => r.pattern.test(text));
  if (!rule) return raw;
  const appendix = truncateRawForAppend(text);
  return appendix ? `${rule.message}（${appendix}）` : rule.message;
}
