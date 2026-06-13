import type { ClaudePluginInstalledEntry } from "../services/claudePluginMarket";
import {
  WISE_AUTHOR_PLUGIN_INSTALLED_LINK,
} from "./wiseAuthorLinks";

const PLUGIN_SCOPE_LABEL: Record<string, string> = {
  user: "用户",
  project: "项目",
  local: "本地",
};

function scopeLabel(scope: string): string {
  return PLUGIN_SCOPE_LABEL[scope] ?? scope;
}

/** 将 CLI 粘连在一行的进度日志拆成多行，便于提取摘要。 */
export function splitPluginCliOutput(raw: string): string[] {
  let text = raw.trim();
  if (!text) return [];

  const breakpoints = [
    "Adding marketplace",
    "Refreshing marketplace",
    "Cloning repository",
    "Clone complete",
    "validating marketplace",
    "Cleaning up",
    "Installing plugin",
    "Uninstalling plugin",
    "Enabling plugin",
    "Disabling plugin",
    "Successfully ",
    "Error:",
    "Failed to",
  ];

  for (const marker of breakpoints) {
    const re = new RegExp(`(?=${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "g");
    text = text.replace(re, "\n");
  }

  text = text.replace(/(?=✔|✓)/g, "\n");
  text = text.replace(/,\s*(?=validating marketplace)/gi, "\n");

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractPluginCliSuccess(lines: string[]): string | null {
  for (const line of lines) {
    const normalized = line.replace(/^[✔✓]\s*/, "").trim();
    if (/^Successfully /i.test(normalized)) {
      return normalized;
    }
    if (/^已(添加|安装|卸载|启用|禁用)/.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

export function extractMarketplaceId(successLine: string | null): string | null {
  if (!successLine) return null;
  const match = successLine.match(/marketplace:\s*([^\s(]+)/i);
  return match?.[1]?.trim() ?? null;
}

export interface PluginCliStepView {
  label: string;
  detail?: string;
}

/** 将 CLI 原始进度行转成可读步骤。 */
export function humanizePluginCliStep(raw: string): PluginCliStepView | null {
  const line = raw.replace(/\.{2,}$/, "").replace(/,$/, "").trim();
  if (!line) return null;

  let match = line.match(/^Refreshing marketplace cache(?:\s*\(timeout:\s*(\d+)s\))?/i);
  if (match) {
    return { label: "刷新市场缓存", detail: match[1] ? `超时 ${match[1]} 秒` : undefined };
  }

  match = line.match(/^Cloning repository(?:\s*\(timeout:\s*(\d+)s\))?:\s*(.+)$/i);
  if (match) {
    const url = match[2]?.trim();
    const timeout = match[1] ? `超时 ${match[1]} 秒` : undefined;
    return { label: "克隆仓库", detail: url ? `\`${url}\`${timeout ? ` · ${timeout}` : ""}` : timeout };
  }

  if (/^Clone complete/i.test(line)) {
    return { label: "克隆完成" };
  }
  if (/^validating marketplace/i.test(line)) {
    return { label: "校验市场清单" };
  }
  if (/^Cleaning up/i.test(line)) {
    return { label: "清理旧缓存" };
  }
  if (/^Adding marketplace/i.test(line)) {
    return { label: "注册市场源" };
  }

  match = line.match(/^Installing plugin\s*(.*)$/i);
  if (match) {
    const target = match[1]?.trim();
    return { label: "安装插件", detail: target ? `\`${target}\`` : undefined };
  }

  match = line.match(/^Uninstalling plugin\s*(.*)$/i);
  if (match) {
    const target = match[1]?.trim();
    return { label: "卸载插件", detail: target ? `\`${target}\`` : undefined };
  }

  match = line.match(/^Enabling plugin\s*(.*)$/i);
  if (match) {
    const target = match[1]?.trim();
    return { label: "启用插件", detail: target ? `\`${target}\`` : undefined };
  }

  match = line.match(/^Disabling plugin\s*(.*)$/i);
  if (match) {
    const target = match[1]?.trim();
    return { label: "禁用插件", detail: target ? `\`${target}\`` : undefined };
  }

  return { label: "执行步骤", detail: line };
}

function collectPluginCliSteps(lines: string[]): PluginCliStepView[] {
  const steps: PluginCliStepView[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^successfully /i.test(line)) continue;
    if (/^✔|^✓/.test(line)) continue;

    const isStep =
      lower.includes("adding marketplace") ||
      lower.includes("refreshing") ||
      lower.includes("cloning") ||
      lower.includes("clone complete") ||
      lower.includes("validating") ||
      lower.includes("cleaning up") ||
      lower.includes("installing") ||
      lower.includes("uninstalling") ||
      lower.includes("enabling plugin") ||
      lower.includes("disabling plugin");

    if (!isStep) continue;

    const view = humanizePluginCliStep(line);
    if (!view) continue;

    const key = `${view.label}|${view.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(view);
  }

  return steps;
}

function formatCliStepsMarkdown(lines: string[]): string | null {
  const steps = collectPluginCliSteps(lines);
  if (steps.length === 0) return null;

  const rendered = steps.map((step, index) => {
    const detail = step.detail?.trim();
    return detail ? `${index + 1}. **${step.label}** — ${detail}` : `${index + 1}. **${step.label}**`;
  });

  return ["#### 执行过程", "", ...rendered].join("\n");
}

function formatPluginRowMarkdown(row: ClaudePluginInstalledEntry): string {
  const version = row.version?.trim() ? ` \`${row.version.trim()}\`` : "";
  const status = row.enabled ? "已启用" : "已禁用";
  return `- **${row.id}**${version} · ${scopeLabel(row.scope)} · ${status}`;
}

export function formatInstalledPluginsMarkdown(rows: ClaudePluginInstalledEntry[]): string {
  if (rows.length === 0) {
    return "当前未安装任何 Claude Code 插件。";
  }

  const lines = [`### 已安装插件（${rows.length}）`, ""];
  for (const row of rows) {
    lines.push(formatPluginRowMarkdown(row));
  }
  lines.push(
    "",
    `> 也可在 [创作 → 插件市场 → 已安装](${WISE_AUTHOR_PLUGIN_INSTALLED_LINK}) 查看。`,
  );
  return lines.join("\n");
}

export interface PluginMarketplaceAddFormatInput {
  source: string;
  cliOutput: string;
  installed: ClaudePluginInstalledEntry[];
}

export function formatPluginMarketplaceAddResult(input: PluginMarketplaceAddFormatInput): string {
  const lines = splitPluginCliOutput(input.cliOutput);
  const success = extractPluginCliSuccess(lines);
  const marketplaceId = extractMarketplaceId(success);
  const steps = formatCliStepsMarkdown(lines);

  const sections = [
    "## ✅ 插件市场已添加",
    "",
    `- **来源**：\`${input.source}\``,
  ];

  if (marketplaceId) {
    sections.push(`- **市场标识**：\`${marketplaceId}\``);
  }
  if (success) {
    sections.push(`- **结果**：${success.replace(/^[✔✓]\s*/, "")}`);
  }

  if (steps) {
    sections.push("", steps);
  }

  sections.push("", "---", "", formatInstalledPluginsMarkdown(input.installed));

  if (marketplaceId) {
    sections.push(
      "",
      `> **下一步**：安装插件可使用 \`/plugin install <插件名>@${marketplaceId}\`，例如 \`/plugin install oh-my-claudecode\`。`,
    );
  }

  return sections.join("\n");
}

export interface PluginMutateFormatInput {
  action: "install" | "uninstall" | "enable" | "disable" | "update";
  installRef?: string;
  scope?: string;
  cliOutput: string;
  installed: ClaudePluginInstalledEntry[];
  extraNote?: string;
}

const PLUGIN_ACTION_HEADLINE: Record<PluginMutateFormatInput["action"], string> = {
  install: "## ✅ 插件安装完成",
  uninstall: "## ✅ 插件已卸载",
  enable: "## ✅ 插件已启用",
  disable: "## ✅ 插件已禁用",
  update: "## ✅ 插件市场已刷新",
};

export function formatPluginMutateResult(input: PluginMutateFormatInput): string {
  const lines = splitPluginCliOutput(input.cliOutput);
  const success = extractPluginCliSuccess(lines);
  const steps = formatCliStepsMarkdown(lines);

  const sections = [PLUGIN_ACTION_HEADLINE[input.action], ""];

  if (input.installRef) {
    sections.push(`- **插件**：\`${input.installRef}\``);
  }
  if (input.scope) {
    sections.push(`- **范围**：${scopeLabel(input.scope)}`);
  }
  if (success) {
    sections.push(`- **结果**：${success.replace(/^[✔✓]\s*/, "")}`);
  } else if (input.cliOutput.trim()) {
    sections.push(`- **输出**：${input.cliOutput.trim()}`);
  }

  if (input.extraNote) {
    sections.push("", `> ${input.extraNote}`);
  }

  if (steps) {
    sections.push("", steps);
  }

  sections.push("", "---", "", formatInstalledPluginsMarkdown(input.installed));

  return sections.join("\n");
}

export function formatPluginCliPassthrough(cliOutput: string, cliArgs: string[]): string {
  const lines = splitPluginCliOutput(cliOutput);
  const success = extractPluginCliSuccess(lines);
  const steps = formatCliStepsMarkdown(lines);
  const command = `claude plugin ${cliArgs.join(" ")}`;

  const sections = ["## 插件命令已完成", "", `- **命令**：\`${command}\``];

  if (success) {
    sections.push(`- **结果**：${success.replace(/^[✔✓]\s*/, "")}`);
  } else if (cliOutput.trim()) {
    sections.push("", cliOutput.trim());
  } else {
    sections.push("- **结果**：无额外输出");
  }

  if (steps) {
    sections.push("", steps);
  }

  return sections.join("\n");
}
