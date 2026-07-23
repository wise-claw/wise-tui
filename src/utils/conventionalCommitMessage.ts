import type { ClaudeSession, GitStatusResponse } from "../types";

export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "chore",
  "test",
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

/** AI 润色提交信息时写入 Claude 的首行提示（历史会话据此识别并隐藏）。 */
export const CONVENTIONAL_COMMIT_PROMPT_HEAD =
  "你是资深工程师，请基于以下 git 改动生成符合 Conventional Commits 规范的提交信息。";

const TYPE_ALIASES: Record<string, ConventionalCommitType> = {
  fixed: "fix",
  feature: "feat",
  doc: "docs",
  refactor: "refactor",
  chore: "chore",
  test: "test",
  feat: "feat",
  fix: "fix",
  docs: "docs",
};

const CONVENTIONAL_HEADER_RE =
  /^(feat|fix|fixed|refactor|docs|doc|chore|test|feature)(\([a-z0-9._-]+\))?!?:\s*(.+)$/i;

const HAS_CJK_RE = /[\u3400-\u9fff]/;

export function conventionalCommitPromptLines(): string[] {
  return [
    CONVENTIONAL_COMMIT_PROMPT_HEAD,
    "要求：",
    "1) 仅输出一行，格式为 type: 中文摘要；",
    "2) type 仅允许 feat、fix、refactor、docs、chore、test（不要用 fixed）；",
    "3) 冒号后的摘要必须使用中文，简明描述改动目的，不要句号；",
    "4) 不要使用 scope，不要输出正文、文件列表或英文摘要；",
    "5) 不要使用 markdown 标题或代码块，不要解释生成过程。",
    "示例：fix: 阻止文件上传超时",
  ];
}

/** 文本是否为 AI 提交信息生成 prompt（含磁盘 preview 截断前缀）。 */
export function isConventionalCommitPromptText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith(CONVENTIONAL_COMMIT_PROMPT_HEAD)
    || trimmed.startsWith("你是资深工程师，请基于以下 git 改动")
  );
}

/**
 * Git 面板 / 一键推送触发的 oneshot 会话：不应出现在「历史会话」列表。
 * 依据首条用户消息或磁盘 preview 是否匹配提交信息 prompt。
 */
export function isConventionalCommitPromptHistorySession(
  session: Pick<ClaudeSession, "messages" | "diskPreview">,
): boolean {
  const firstUser = session.messages.find((message) => message.role === "user");
  if (firstUser && isConventionalCommitPromptText(firstUser.content)) {
    return true;
  }
  const diskPreview = session.diskPreview?.trim();
  return Boolean(diskPreview && isConventionalCommitPromptText(diskPreview));
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```[\w-]*\n?/gm, "")
    .replace(/\n?```$/gm, "")
    .trim();
}

function normalizeCommitType(rawType: string): ConventionalCommitType {
  const key = rawType.trim().toLowerCase();
  return TYPE_ALIASES[key] ?? "feat";
}

function normalizeHeaderLine(header: string): string {
  const match = header.trim().match(/^(\w+)(\([^)]+\))?!?:\s*(.+)$/i);
  if (!match) return header.trim();
  const [, rawType, , subject] = match;
  const type = normalizeCommitType(rawType!);
  const normalizedSubject = subject!.trim().replace(/[。．.!！?？]+$/, "");
  return `${type}: ${normalizedSubject}`;
}

function pickHeaderLine(raw: string): string {
  const cleaned = stripCodeFences(raw).trim();
  if (!cleaned) return "chore: 更新代码";

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const conventional = lines.find((line) => CONVENTIONAL_HEADER_RE.test(line));
  if (conventional) {
    const header = normalizeHeaderLine(conventional);
    const subject = header.replace(/^[^:]+:\s*/, "");
    if (HAS_CJK_RE.test(subject)) {
      return header;
    }
  }

  const chineseSubjectLine = lines.find(
    (line) =>
      HAS_CJK_RE.test(line) &&
      !line.startsWith("-") &&
      !/^涉及文件|^变更统计|^文件|^统计|^仓库|^分支/.test(line),
  );
  if (chineseSubjectLine) {
    if (CONVENTIONAL_HEADER_RE.test(chineseSubjectLine)) {
      return normalizeHeaderLine(chineseSubjectLine);
    }
    const withoutPrefix = chineseSubjectLine
      .replace(/^(feat|fix|fixed|refactor|docs|chore|test)[：:\s-]+/i, "")
      .trim();
    return normalizeHeaderLine(`feat: ${withoutPrefix || chineseSubjectLine}`);
  }

  const first = lines[0] ?? "更新代码";
  const withoutPrefix = first.replace(/^(feat|fix|fixed|refactor|docs|chore|test)[：:\s-]+/i, "").trim();
  const subject = withoutPrefix || first;
  if (HAS_CJK_RE.test(subject)) {
    return normalizeHeaderLine(`feat: ${subject}`);
  }
  return "feat: 更新代码变更";
}

/** 规范化 AI/用户输入，输出单行 `type: 中文摘要`。 */
export function normalizeConventionalCommitMessage(raw: string): string {
  return pickHeaderLine(raw);
}

function inferCommitType(paths: string[]): ConventionalCommitType {
  if (paths.length === 0) return "chore";
  const testOnly = paths.every(
    (path) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
      path.includes("__tests__") ||
      path.includes("/tests/"),
  );
  if (testOnly) return "test";
  const docsOnly = paths.every(
    (path) => path.endsWith(".md") || path.startsWith("docs/") || path.startsWith(".trellis/"),
  );
  if (docsOnly) return "docs";
  if (
    paths.some((path) =>
      /^(package\.json|bun\.lock|Cargo\.lock|pnpm-lock|yarn\.lock|\.github\/)/.test(path),
    )
  ) {
    return "chore";
  }
  if (paths.some((path) => /fix|bug|hotfix/i.test(path))) return "fix";
  if (paths.some((path) => /refactor|rename|move/i.test(path))) return "refactor";
  return "feat";
}

function inferAreaLabel(paths: string[]): string {
  for (const path of paths) {
    if (path.startsWith("src/components/GitPanel/")) return "Git 面板";
    if (path.startsWith("src/components/ClaudeSessions/")) return "会话界面";
    if (path.startsWith("src/components/ClaudeChatInput/")) return "输入框";
    if (path.startsWith("src/components/LeftSidebar/")) return "侧边栏";
    if (path.startsWith("src-tauri/")) return "Tauri 后端";
    if (path.startsWith("src/services/")) return "服务层";
    if (path.startsWith("src/")) return "前端";
  }
  return "代码";
}

function inferChineseSubject(type: ConventionalCommitType, paths: string[], fileCount: number): string {
  const area = inferAreaLabel(paths);
  if (fileCount <= 0) return "更新工作区变更";
  if (type === "fix") return `修复${area}相关问题`;
  if (type === "refactor") return `重构${area}相关代码`;
  if (type === "docs") return `更新${area}文档`;
  if (type === "test") return `补充${area}测试`;
  if (type === "chore") return `维护${area}配置与依赖`;
  if (fileCount === 1) {
    const path = paths[0] ?? "";
    if (!path.includes("/")) {
      return `更新 ${path} 相关变更`;
    }
    const baseName = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "模块";
    return `更新${area}${baseName}相关逻辑`;
  }
  return `更新${area}等 ${fileCount} 处变更`;
}

/** 无 AI 时的 Conventional Commits 兜底提交信息（单行中文摘要）。 */
export function buildConventionalCommitFallback(status: GitStatusResponse): string {
  const changedFiles = [...status.staged, ...status.unstaged];
  const paths = Array.from(new Set(changedFiles.map((item) => item.path)));
  const type = inferCommitType(paths);
  const subject = inferChineseSubject(type, paths, paths.length);
  return `${type}: ${subject}`;
}

export function isChineseCommitSubject(subject: string): boolean {
  return HAS_CJK_RE.test(subject.trim());
}
