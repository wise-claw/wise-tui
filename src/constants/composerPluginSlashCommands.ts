import {
  CLAUDE_PLUGIN_MARKET_CATALOG,
  CLAUDE_PLUGIN_PINNED_INSTALL_REFS,
  claudePluginInstallRef,
  sortClaudePluginCatalogEntries,
  type ClaudePluginCatalogEntry,
} from "./claudePluginMarketCatalog";
import type { ClaudePluginInstalledEntry } from "../services/claudePluginMarket";

export interface ComposerPluginSlashCommandEntry {
  label: string;
  description: string;
}

/** Wise 会话内可本地执行的 /plugin 子命令（不含顶层 `plugin`，见内置目录）。 */
export const COMPOSER_PLUGIN_SLASH_SUBCOMMANDS: readonly ComposerPluginSlashCommandEntry[] = [
  {
    label: "plugin install",
    description: "安装插件，例：/plugin install oh-my-claudecode@omc --scope user",
  },
  {
    label: "plugin uninstall",
    description: "卸载已安装插件",
  },
  {
    label: "plugin enable",
    description: "启用已安装插件",
  },
  {
    label: "plugin disable",
    description: "禁用已安装插件",
  },
  {
    label: "plugin list",
    description: "列出当前已安装插件",
  },
  {
    label: "plugin marketplace add",
    description: "添加插件市场源，例：/plugin marketplace add owner/repo",
  },
  {
    label: "plugin marketplace update",
    description: "刷新已添加的插件市场目录",
  },
] as const;

const PLUGIN_SCOPE_LABEL: Record<string, string> = {
  user: "用户",
  project: "项目",
  local: "本地",
};

function installedPluginRefArg(row: ClaudePluginInstalledEntry): string {
  const id = row.id.trim();
  const scope = row.scope.trim().toLowerCase();
  if (!scope || scope === "user") return id;
  return `${id} --scope ${scope}`;
}

function isPluginInstallRefAlreadyInstalled(
  installRef: string,
  installed: readonly ClaudePluginInstalledEntry[],
): boolean {
  const normalized = installRef.trim().toLowerCase();
  const pluginId = normalized.split("@")[0] ?? normalized;
  return installed.some((row) => {
    const id = row.id.trim().toLowerCase();
    return id === normalized || (id.split("@")[0] ?? id) === pluginId;
  });
}

/** 已安装插件的管理命令：卸载 / 启用 / 禁用。 */
export function buildComposerPluginInstalledSlashCommands(
  installed: readonly ClaudePluginInstalledEntry[],
): ComposerPluginSlashCommandEntry[] {
  const rows = [...installed].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id),
  );
  const result: ComposerPluginSlashCommandEntry[] = [];

  for (const row of rows) {
    const ref = installedPluginRefArg(row);
    const scopeText = PLUGIN_SCOPE_LABEL[row.scope] ?? row.scope;
    const status = row.enabled ? "已启用" : "已禁用";

    result.push({
      label: `plugin uninstall ${ref}`,
      description: `卸载${status}插件（${scopeText}）`,
    });
    if (row.enabled) {
      result.push({
        label: `plugin disable ${ref}`,
        description: `禁用插件（${scopeText}）`,
      });
    } else {
      result.push({
        label: `plugin enable ${ref}`,
        description: `启用插件（${scopeText}）`,
      });
    }
  }

  return result;
}

function catalogEntryForInstallRef(ref: string): ClaudePluginCatalogEntry | null {
  return (
    CLAUDE_PLUGIN_MARKET_CATALOG.find((entry) => claudePluginInstallRef(entry) === ref) ?? null
  );
}

function buildInstallTemplate(entry: ClaudePluginCatalogEntry): ComposerPluginSlashCommandEntry {
  const ref = claudePluginInstallRef(entry);
  return {
    label: `plugin install ${ref}`,
    description: `安装 ${entry.name}：${entry.description}`,
  };
}

/** 置顶 + 精选可一键安装插件，供 `/plugin install` 补全。 */
export function buildComposerPluginInstallSlashCommands(
  installed: readonly ClaudePluginInstalledEntry[] = [],
): ComposerPluginSlashCommandEntry[] {
  const pinned = CLAUDE_PLUGIN_PINNED_INSTALL_REFS.map((ref) => catalogEntryForInstallRef(ref)).filter(
    (entry): entry is ClaudePluginCatalogEntry => entry != null,
  );
  const pinnedRefs = new Set(pinned.map((entry) => claudePluginInstallRef(entry)));
  const featured = sortClaudePluginCatalogEntries(CLAUDE_PLUGIN_MARKET_CATALOG)
    .filter((entry) => entry.oneClickInstall !== false && entry.featured)
    .filter((entry) => !pinnedRefs.has(claudePluginInstallRef(entry)));

  const merged = [...pinned, ...featured].slice(0, 16);
  return merged
    .map(buildInstallTemplate)
    .filter((cmd) => {
      const match = cmd.label.match(/^plugin install (.+)$/i);
      if (!match) return true;
      return !isPluginInstallRefAlreadyInstalled(match[1] ?? "", installed);
    });
}
