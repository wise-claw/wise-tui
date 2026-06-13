import {
  getClaudeHooksStatus,
  getClaudeMcpRuntimeHealth,
  getClaudeMcpStatus,
  listClaudeProjectSkills,
  listClaudeSubagents,
  listClaudeUserSkills,
  runClaudeCliCommand,
} from "./claude";
import {
  buildContextBreakdownSnapshot,
  formatContextTokenCount,
  loadContextOverheadEstimate,
} from "./claudeContextBreakdown";
import {
  formatContextStatusHint,
  getSessionContextMetrics,
} from "./claudeSessionContext";
import {
  claudePluginInstall,
  claudePluginListInstalled,
  claudePluginMarketBootstrap,
  claudePluginUninstall,
} from "./claudePluginMarket";
import type { ClaudeHookScopeData, ClaudeMcpItem, ClaudeSession } from "../types";
import { formatClaudeModelLabel } from "../utils/claudeModel";
import {
  COMPOSER_LOCAL_SLASH_HELP,
  parseComposerLocalSlashCommand,
  resolveComposerPluginInstallRef,
  type ComposerLocalSlashCommand,
  type ComposerPluginSlashCommand,
} from "../utils/composerLocalSlashCommand";

export { parseComposerLocalSlashCommand, COMPOSER_LOCAL_SLASH_HELP };

export interface ComposerLocalSlashDeps {
  sessionId: string;
  repositoryPath: string;
  repositoryName?: string;
  session?: ClaudeSession | null;
  compactSessionHistory?: (sessionId: string, prompt?: string) => void | Promise<void>;
  createNewSession?: () => void | Promise<void>;
}

function formatInstalledPlugins(
  rows: Awaited<ReturnType<typeof claudePluginListInstalled>>,
): string {
  if (rows.length === 0) {
    return "当前未安装任何 Claude Code 插件。";
  }
  const lines = rows.map((row) => {
    const version = row.version?.trim() ? ` v${row.version.trim()}` : "";
    const status = row.enabled ? "已启用" : "已禁用";
    return `• ${row.id}${version}（${row.scope} · ${status}）`;
  });
  return ["已安装插件：", ...lines].join("\n");
}

async function executePluginCommand(
  command: ComposerPluginSlashCommand,
  repositoryPath?: string | null,
): Promise<string> {
  if (command.action === "list") {
    const rows = await claudePluginListInstalled(repositoryPath);
    return formatInstalledPlugins(rows);
  }

  const installRef = resolveComposerPluginInstallRef(command.installRef ?? "");
  const scope = command.scope;

  if (command.action === "install") {
    const boot = await claudePluginMarketBootstrap();
    await claudePluginInstall(installRef, scope, repositoryPath);
    const bootHint = boot.log.trim();
    const base = `已安装插件 ${installRef}（范围：${scope}）。新开 Claude 会话后生效。`;
    return bootHint ? `${base}\n\n${bootHint}` : base;
  }

  if (command.action === "uninstall") {
    await claudePluginUninstall(installRef, scope, repositoryPath);
    return `已卸载插件 ${installRef}（范围：${scope}）。`;
  }

  const cliVerb = command.action === "enable" ? "enable" : "disable";
  const out = await runClaudeCliCommand(
    ["plugin", cliVerb, installRef, "--scope", scope],
    repositoryPath,
    { timeoutMs: 120_000 },
  );
  const verbLabel = command.action === "enable" ? "启用" : "禁用";
  return out.trim() || `已${verbLabel}插件 ${installRef}（范围：${scope}）。`;
}

function mcpScopeLabel(scope: ClaudeMcpItem["scope"]): string {
  switch (scope) {
    case "user":
      return "用户";
    case "local":
      return "本地";
    case "project":
      return "项目";
    case "plugin":
      return "插件";
    default:
      return scope;
  }
}

function formatMcpItem(item: ClaudeMcpItem, healthByName: Map<string, string>): string {
  const runtime = healthByName.get(item.name);
  const runtimeLabel =
    runtime === "connected" ? "运行中" : runtime === "failed" ? "连接失败" : "未检测";
  const enabled = item.enabled ? "已启用" : "已禁用";
  const tools = item.tools.length > 0 ? ` · 工具 ${item.tools.length} 个` : "";
  return `• ${item.name}（${mcpScopeLabel(item.scope)} · ${enabled} · ${runtimeLabel}${tools}）`;
}

async function formatMcpList(repositoryPath: string): Promise<string> {
  const [status, health] = await Promise.all([
    getClaudeMcpStatus(repositoryPath),
    getClaudeMcpRuntimeHealth(repositoryPath).catch(
      () => [] as Awaited<ReturnType<typeof getClaudeMcpRuntimeHealth>>,
    ),
  ]);
  const healthByName = new Map(health.map((row) => [row.name, row.status]));
  const sections: Array<{ title: string; items: ClaudeMcpItem[] }> = [
    { title: "用户级", items: status.user },
    { title: "项目本地", items: status.local },
    { title: "项目共享", items: status.projectShared },
    { title: "插件 MCP", items: status.pluginMcp },
    { title: "旧版用户设置", items: status.legacyUserSettings },
    { title: "旧版项目设置", items: status.legacyProjectSettings },
  ];
  const lines: string[] = ["MCP 服务列表："];
  let total = 0;
  for (const section of sections) {
    if (section.items.length === 0) continue;
    lines.push("", `【${section.title}】`);
    for (const item of section.items) {
      lines.push(formatMcpItem(item, healthByName));
      total += 1;
    }
  }
  if (total === 0) {
    lines.push("（未配置 MCP）");
  }
  lines.push("", "在 Wise 中管理：创作 → MCP，或使用 Claude Code 工具面板。");
  return lines.join("\n");
}

async function formatSkillsList(repositoryPath: string): Promise<string> {
  const [userSkills, projectSkills] = await Promise.all([
    listClaudeUserSkills(),
    listClaudeProjectSkills(repositoryPath),
  ]);
  const lines: string[] = ["Skills 列表："];
  if (userSkills.length > 0) {
    lines.push("", "【用户级 ~/.claude/skills】");
    for (const skill of userSkills) {
      const desc = skill.description?.trim();
      lines.push(`• ${skill.name}${desc ? ` — ${desc}` : ""}`);
    }
  }
  if (projectSkills.length > 0) {
    lines.push("", "【项目级 .claude/skills】");
    for (const skill of projectSkills) {
      const desc = skill.description?.trim();
      const kind = skill.kind === "command" ? "命令" : "技能";
      lines.push(`• ${skill.name}（${kind}）${desc ? ` — ${desc}` : ""}`);
    }
  }
  if (userSkills.length === 0 && projectSkills.length === 0) {
    lines.push("（未发现 Skills）");
  }
  lines.push("", "在 Wise 中管理：创作 → Skills Hub。");
  return lines.join("\n");
}

function summarizeHookScope(title: string, scope: ClaudeHookScopeData): string[] {
  const lines: string[] = [];
  const eventNames = Object.keys(scope.hooks);
  if (scope.disableAllHooks) {
    lines.push(`【${title}】全部 Hook 已禁用`);
    return lines;
  }
  if (eventNames.length === 0) {
    return lines;
  }
  let handlerCount = 0;
  for (const groups of Object.values(scope.hooks)) {
    for (const group of groups) {
      handlerCount += group.hooks.length;
    }
  }
  lines.push(`【${title}】${eventNames.length} 个事件 · ${handlerCount} 条处理器`);
  for (const event of eventNames.sort()) {
    const groups = scope.hooks[event] ?? [];
    const count = groups.reduce((sum, g) => sum + g.hooks.length, 0);
    lines.push(`  • ${event}（${count}）`);
  }
  return lines;
}

async function formatHooksList(repositoryPath: string): Promise<string> {
  const status = await getClaudeHooksStatus(repositoryPath);
  const lines: string[] = ["Hook 配置摘要："];
  lines.push(
    ...summarizeHookScope("用户级", status.user),
    ...summarizeHookScope("项目级", status.project),
    ...summarizeHookScope("本地", status.local),
    ...summarizeHookScope("OMC", status.omc),
  );
  if (lines.length === 1) {
    lines.push("（未配置 Hook）");
  }
  lines.push("", "在 Wise 中编辑：默认配置 → Claude Hooks。");
  return lines.join("\n");
}

async function formatAgentsList(repositoryPath: string): Promise<string> {
  const agents = await listClaudeSubagents(repositoryPath);
  if (agents.length === 0) {
    return "子代理列表：\n（未发现 .claude/agents 配置）\n\n在 Wise 中管理：Claude Code 工具 → 子代理。";
  }
  const lines = ["子代理列表："];
  for (const agent of agents) {
    const active = agent.isActive ? " · 活跃" : "";
    const desc = agent.description?.trim();
    lines.push(`• ${agent.name}（${agent.scope}${active}）${desc ? ` — ${desc}` : ""}`);
  }
  lines.push("", "运行中任务与团队：侧栏「我的团队」。");
  return lines.join("\n");
}

function formatSessionStatus(session: ClaudeSession): string {
  const model = formatClaudeModelLabel(session.model);
  const claudeId = session.claudeSessionId?.trim() || "（尚未建立）";
  const msgCount = session.messages.length;
  const statusMap: Record<ClaudeSession["status"], string> = {
    idle: "空闲",
    connecting: "连接中",
    running: "运行中",
    completed: "已完成",
    cancelled: "已取消",
    error: "错误",
  };
  return [
    "当前会话状态：",
    `• 标签 ID：${session.id}`,
    `• Claude session_id：${claudeId}`,
    `• 模型：${model}`,
    `• 状态：${statusMap[session.status] ?? session.status}`,
    `• 消息条数：${msgCount}`,
    `• 仓库：${session.repositoryName || session.repositoryPath}`,
    session.diskTranscriptPartial ? "• 历史：仅加载部分 transcript（可点「加载完整历史」）" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function formatContextUsage(
  session: ClaudeSession,
  detailed: boolean,
): Promise<string> {
  const metrics = getSessionContextMetrics(session);
  const hint = formatContextStatusHint(metrics);
  const lines = [
    "## 上下文占用（Wise 估算）",
    `约 ${formatContextTokenCount(metrics.estimatedTokens)} tokens（${metrics.ctxPercent}%）`,
  ];
  if (hint) {
    lines.push(hint);
  }
  if (!detailed) {
    lines.push("", "发送 /context all 查看分类明细。");
    return lines.join("\n");
  }

  const overhead = await loadContextOverheadEstimate(session.repositoryPath);
  const snapshot = buildContextBreakdownSnapshot(session, overhead, metrics);
  lines.push("", "### 分类明细");
  for (const category of snapshot.categories) {
    if (category.tokens <= 0) continue;
    lines.push(`• ${category.label}：${formatContextTokenCount(category.tokens)}`);
  }
  if (snapshot.estimated) {
    lines.push("", "（基于本地配置与消息估算，非 Claude TUI 实测）");
  }
  return lines.join("\n");
}

function pendingLabelFor(command: ComposerLocalSlashCommand): string {
  switch (command.kind) {
    case "plugin": {
      const plugin = command.plugin;
      if (!plugin) return "正在处理插件命令…";
      if (plugin.action === "install") return `正在安装插件 ${plugin.installRef ?? ""}…`;
      if (plugin.action === "uninstall") return `正在卸载插件 ${plugin.installRef ?? ""}…`;
      if (plugin.action === "enable") return `正在启用插件 ${plugin.installRef ?? ""}…`;
      if (plugin.action === "disable") return `正在禁用插件 ${plugin.installRef ?? ""}…`;
      return "正在读取已安装插件…";
    }
    case "compact":
      return "正在执行 /compact 压缩会话历史…";
    case "clear":
      return "正在新建空白会话…";
    case "mcp":
      return "正在读取 MCP 配置…";
    case "skills":
      return "正在扫描 Skills…";
    case "hooks":
      return "正在读取 Hook 配置…";
    case "agents":
      return "正在读取子代理配置…";
    case "status":
      return "正在读取会话状态…";
    case "context":
      return command.contextDetailed ? "正在计算上下文明细…" : "正在计算上下文占用…";
    case "doctor":
      return "正在运行 claude doctor…";
    case "reload_plugins":
      return "正在刷新插件市场…";
    case "reload_skills":
      return "正在重新扫描 Skills…";
    case "redirect":
      return command.redirectMessage ?? "该命令需在 Wise 中通过替代入口完成。";
    case "config":
      return [
        "Claude Code 交互式 /config 在 Wise 嵌入式会话中不可用。",
        "请在 Wise 顶栏「默认配置」中管理 Claude 连接、模型、FCC 与相关设置。",
        "插件：创作 → 插件市场；MCP：创作 → MCP；Skills：创作 → Skills Hub。",
      ].join("\n");
    default:
      return "正在处理命令…";
  }
}

export function composerLocalSlashPendingMessage(command: ComposerLocalSlashCommand): string | null {
  if (
    command.kind === "help" ||
    command.kind === "config" ||
    command.kind === "compact" ||
    command.kind === "redirect"
  ) {
    return null;
  }
  return pendingLabelFor(command);
}

export async function executeComposerLocalSlashCommand(
  command: ComposerLocalSlashCommand,
  deps: ComposerLocalSlashDeps,
): Promise<string | null> {
  const { sessionId, repositoryPath, session } = deps;

  switch (command.kind) {
    case "redirect":
      return command.redirectMessage ?? "该命令在嵌入式会话中不可用。";

    case "plugin":
      if (!command.plugin) throw new Error("插件命令解析失败");
      return executePluginCommand(command.plugin, repositoryPath);

    case "compact": {
      if (!deps.compactSessionHistory) {
        throw new Error("当前会话不支持 /compact");
      }
      await deps.compactSessionHistory(sessionId, command.raw.trim());
      return null;
    }

    case "clear": {
      if (!deps.createNewSession) {
        throw new Error("当前环境不支持 /clear");
      }
      await deps.createNewSession();
      return "已新建空白会话标签（等同 /clear）。旧会话仍可在标签栏或 /resume 找回。";
    }

    case "mcp":
      return formatMcpList(repositoryPath);

    case "skills":
      return formatSkillsList(repositoryPath);

    case "hooks":
      return formatHooksList(repositoryPath);

    case "agents":
      return formatAgentsList(repositoryPath);

    case "status": {
      if (!session) {
        throw new Error("无法读取当前会话状态");
      }
      return formatSessionStatus(session);
    }

    case "context": {
      if (!session) {
        throw new Error("无法计算上下文占用");
      }
      return formatContextUsage(session, command.contextDetailed === true);
    }

    case "doctor": {
      const out = await runClaudeCliCommand(["doctor"], repositoryPath, { timeoutMs: 300_000 });
      return out.trim() || "claude doctor 已完成，无额外输出。";
    }

    case "reload_plugins": {
      await claudePluginMarketBootstrap();
      return "已刷新插件市场缓存。请新开 Claude 会话以加载最新插件。";
    }

    case "reload_skills": {
      const out = await runClaudeCliCommand(["-p", "/reload-skills"], repositoryPath, {
        timeoutMs: 60_000,
      });
      return out.trim() || "已重新扫描 Skills 目录。";
    }

    case "help":
      return COMPOSER_LOCAL_SLASH_HELP;

    case "config":
      return pendingLabelFor(command);

    default:
      throw new Error("不支持的本地斜杠命令");
  }
}
