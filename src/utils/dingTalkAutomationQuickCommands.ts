import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";

export type DingTalkAutomationQuickCommand =
  | { kind: "none" }
  | { kind: "list_repositories" }
  | { kind: "switch_repository"; repoFilter: string }
  | { kind: "new_session"; repoFilter: string };

const LIST_PHRASES = [
  "查询仓库",
  "查看仓库",
  "仓库列表",
  "列出仓库",
  "列出所有仓库",
  "当前有哪些仓库",
] as const;

function splitPromptLines(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** 去掉零宽字符、全角空格，折叠空白，便于与钉钉侧回传的原文对齐 */
function normalizeQuickCommandWhitespace(raw: string): string {
  return raw
    .replace(/[\u200b-\u200d\ufeff\u2060]/g, "")
    .replace(/\u3000/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** 去掉行首 @机器人 / @[显示名] 等钉钉常见前缀（@ 后可无空格） */
function stripLeadingDingTalkMentions(raw: string): string {
  let t = normalizeQuickCommandWhitespace(raw);
  for (let i = 0; i < 8; i += 1) {
    const bracket = t.match(/^@\[[^\]]+]\s*/);
    if (bracket) {
      t = t.slice(bracket[0].length).trim();
      continue;
    }
    const atWord = t.match(/^@\S+/);
    if (atWord) {
      t = t.slice(atWord[0].length).trim();
      continue;
    }
    break;
  }
  return t.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 是否为「仅列仓库」类短指令（整段去掉空白后不宜过长，避免误伤长文里出现词组）。
 */
function isListRepositoriesIntent(prompt: string): boolean {
  const stripped = stripLeadingDingTalkMentions(prompt);
  if (!stripped) return false;
  const lines = splitPromptLines(stripped);
  const head = normalizeQuickCommandWhitespace(lines[0] ?? "");
  if (!head) return false;
  if (lines.length > 1) {
    const rest = lines.slice(1).join(" ").trim();
    if (rest.length > 24) {
      return false;
    }
  }
  const compact = head.replace(/\s/g, "");
  if (compact.length > 36) return false;

  const polite = "^(请|麻烦|帮我)?";
  const tail = "(一下|下)?([。！？.!?…\\s]*)$";

  for (const phrase of LIST_PHRASES) {
    const body = escapeRegExp(phrase);
    const re = new RegExp(`${polite}${body}${tail}`, "i");
    if (re.test(head)) {
      return true;
    }
  }
  return false;
}

const POLITE = "(?:请|麻烦|帮我)?\\s*";
const SWITCH_KW = "(?:切换仓库|换仓库)";

/**
 * 解析「切换仓库」类快捷指令；未命中返回 null。
 * - 首行仅命令、仓库名在次行（与钉钉 @ 机器人换行一致）
 * - 支持「请 / 一下」、全角冒号、`换仓库`、`切换到 xxx`
 */
function tryParseSwitchRepositoryQuick(
  prompt: string,
  repositoryNameFromPayload: string | null | undefined,
): DingTalkAutomationQuickCommand | null {
  const stripped = stripLeadingDingTalkMentions(prompt);
  if (!stripped) return null;

  const lines = splitPromptLines(stripped);
  const first = normalizeQuickCommandWhitespace(lines[0] ?? "");
  const restJoined = lines.slice(1).join(" ").trim();
  if (!first) return null;

  if (lines.length > 1 && restJoined.length > 120) {
    return null;
  }

  const fb = (repositoryNameFromPayload ?? "").trim();

  // 「切换到 xxx」或「请切换到 xxx」
  const switchTo = first.match(new RegExp(`^${POLITE}切换到\\s+(.+)$`, "i"));
  if (switchTo?.[1]) {
    const q = switchTo[1].replace(/[。！？…]+$/g, "").trim();
    if (q.length > 0 && q.length <= 120) {
      return { kind: "switch_repository", repoFilter: q };
    }
  }

  // 首行仅「切换仓库 / 换仓库 / 请切换仓库」等，目标在后续行或 JSON repositoryName
  const onlyCmd = new RegExp(`^${POLITE}${SWITCH_KW}(一下|下)?([。！？.!?…\\s]*)$`, "i");
  if (onlyCmd.test(first)) {
    const name = (restJoined.length > 0 ? restJoined : fb).trim();
    return { kind: "switch_repository", repoFilter: name };
  }

  // 首行「切换仓库 xxx」「请切换仓库：xxx」
  const inline = first.match(new RegExp(`^${POLITE}${SWITCH_KW}(?:\\s*[:：]\\s*|\\s+)(.+)$`, "i"));
  if (inline?.[1]) {
    const q = inline[1].replace(/[。！？…]+$/g, "").trim();
    if (q.length > 0) {
      return { kind: "switch_repository", repoFilter: q };
    }
  }

  return null;
}

const NEW_SESSION_KW = "(?:新建会话|新开会话|创建会话|创建新会话|新建标签|新开标签)";

/**
 * 解析「新建会话」类快捷指令；未命中返回 null。
 * - 仓库名可写在首行命令后、次行，或仅用命令并在入站 JSON 带 repositoryName
 */
function tryParseNewSessionQuick(
  prompt: string,
  repositoryNameFromPayload: string | null | undefined,
): DingTalkAutomationQuickCommand | null {
  const stripped = stripLeadingDingTalkMentions(prompt);
  if (!stripped) return null;

  const lines = splitPromptLines(stripped);
  const first = normalizeQuickCommandWhitespace(lines[0] ?? "");
  const restJoined = lines.slice(1).join(" ").trim();
  if (!first) return null;

  if (lines.length > 1 && restJoined.length > 120) {
    return null;
  }

  const fb = (repositoryNameFromPayload ?? "").trim();

  const onlyCmd = new RegExp(`^${POLITE}${NEW_SESSION_KW}(一下|下)?([。！？.!?…\\s]*)$`, "i");
  if (onlyCmd.test(first)) {
    const name = (restJoined.length > 0 ? restJoined : fb).trim();
    return { kind: "new_session", repoFilter: name };
  }

  const inline = first.match(new RegExp(`^${POLITE}${NEW_SESSION_KW}(?:\\s*[:：]\\s*|\\s+)(.+)$`, "i"));
  if (inline?.[1]) {
    const q = inline[1].replace(/[。！？…]+$/g, "").trim();
    if (q.length > 0) {
      return { kind: "new_session", repoFilter: q };
    }
  }

  return null;
}

/**
 * 钉钉网关入站：识别「查询仓库」「切换仓库」「新建会话」等短指令（容忍 @ 前缀与礼貌用语）。
 */
export function detectDingTalkAutomationQuickCommand(
  prompt: string,
  repositoryNameFromPayload: string | null | undefined,
): DingTalkAutomationQuickCommand {
  if (isListRepositoriesIntent(prompt)) {
    return { kind: "list_repositories" };
  }

  const sw = tryParseSwitchRepositoryQuick(prompt, repositoryNameFromPayload);
  if (sw) {
    return sw;
  }

  const nw = tryParseNewSessionQuick(prompt, repositoryNameFromPayload);
  if (nw) {
    return nw;
  }

  return { kind: "none" };
}

const DINGTALK_REPO_LIST_MAX_LINES = 80;

export function formatRepositoriesMarkdownForDingTalk(
  repositories: Repository[],
  projects: ProjectItem[],
): string {
  if (repositories.length === 0) {
    return "当前 Wise 中暂无已添加的仓库。请在桌面端「关联仓库」后再试。";
  }
  const lines: string[] = ["**Wise 已添加的仓库**", ""];
  let n = 0;
  for (const r of repositories) {
    if (n >= DINGTALK_REPO_LIST_MAX_LINES) {
      lines.push("");
      lines.push(`…（共 ${repositories.length} 个，此处仅列出前 ${DINGTALK_REPO_LIST_MAX_LINES} 条，完整列表请在桌面端侧栏查看）`);
      break;
    }
    const base = repositoryFolderBasename(r);
    const projectNames = projects
      .filter((p) => p.repositoryIds.includes(r.id))
      .map((p) => p.name)
      .join("、");
    const proj = projectNames.length > 0 ? `，项目：${projectNames}` : "";
    lines.push(`- **${r.name}**（目录 \`${base}\`${proj}）`);
    n += 1;
  }
  return lines.join("\n");
}
