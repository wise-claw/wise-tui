const EMPLOYEE_SEGMENT = "/员工:";

/** 从 `repositoryName` 展示串中解析绑定员工姓名（无则 null）。 */
export function extractEmployeeNameFromRepositoryDisplay(repositoryDisplayName: string): string | null {
  const r = repositoryDisplayName.trim();
  const idx = r.indexOf(EMPLOYEE_SEGMENT);
  if (idx < 0) {
    return null;
  }
  const name = r.slice(idx + EMPLOYEE_SEGMENT.length).trim();
  return name || null;
}

/**
 * 会话的 `repositoryName` 展示里，「仓库」与「/员工:…」分段；无员工段时整段视为仓库名。
 */
export function getRepositoryBaseDisplayName(repositoryDisplayName: string): string {
  const r = repositoryDisplayName.trim();
  if (!r) {
    return "";
  }
  const idx = r.indexOf(EMPLOYEE_SEGMENT);
  if (idx < 0) {
    return r;
  }
  return r.slice(0, idx).trim();
}

/**
 * 在已绑定仓库的会话里，预览/首条消息若以 `[仓库名]`、`[仓库/员工:…]` 等与当前展示名重复的前缀开头，则去掉该段，避免与当前仓库上下文重复。
 */
export function stripRedundantRepoBracketPrefix(text: string, repositoryDisplayName: string): string {
  const t = text.trim();
  const repo = repositoryDisplayName.trim();
  if (!t.startsWith("[") || !repo) {
    return text;
  }
  const close = t.indexOf("]");
  if (close <= 1) {
    return text;
  }
  const inner = t.slice(1, close).trim();
  const base = getRepositoryBaseDisplayName(repo);
  if (inner === repo || inner === base) {
    return t.slice(close + 1).trimStart();
  }
  return text;
}

/**
 * 通知正文前缀：在仓库上下文中不再重复裸仓库名；员工会话仅保留 `[员工:姓名]` 便于解析归属。
 */
export function notificationBodyPrefixInRepositoryContext(repositoryDisplayName: string): string {
  const r = repositoryDisplayName.trim();
  if (!r) {
    return "";
  }
  const idx = r.indexOf(EMPLOYEE_SEGMENT);
  if (idx < 0) {
    return "";
  }
  const employeeName = r.slice(idx + EMPLOYEE_SEGMENT.length).trim();
  return employeeName ? `[员工:${employeeName}] ` : "";
}

/**
 * 消息通知列表展示：已在当前仓库会话下时，去掉正文开头方括号内与当前仓库基名重复的「仓库名/」段。
 * 例：`[vocs-web/员工:独立前端] The user…` + `repositoryName` 为 `vocs-web/员工:独立前端` → `[员工:独立前端] The user…`
 * 例：`[vocs-web] …` + 主会话 `repositoryName` 为 `vocs-web` → 去掉整段方括号前缀，仅保留后续正文。
 */
export function formatInboundNotificationBodyForRepositoryContext(
  body: string,
  repositoryDisplayName: string,
): string {
  const b = body.trim();
  const repo = repositoryDisplayName.trim();
  if (!b.startsWith("[") || !repo) {
    return body;
  }
  const close = b.indexOf("]");
  if (close <= 1) {
    return body;
  }
  const inner = b.slice(1, close).trim();
  const rest = b.slice(close + 1).trimStart();
  const base = getRepositoryBaseDisplayName(repo);
  if (!base) {
    return body;
  }
  if (inner === base) {
    return rest;
  }
  if (inner.startsWith(`${base}/`)) {
    const tail = inner.slice(base.length + 1).trim();
    if (!tail) {
      return rest;
    }
    return rest ? `[${tail}] ${rest}` : `[${tail}]`;
  }
  return body;
}
