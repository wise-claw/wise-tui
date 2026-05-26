import {
  claudePluginInstallRef,
  getClaudeLspCoreCatalogEntries,
  type ClaudePluginCatalogEntry,
} from "../constants/claudePluginMarketCatalog";
import {
  claudePluginInstall,
  claudePluginListInstalled,
  claudePluginMarketBootstrap,
  claudePluginUninstall,
  type ClaudePluginInstalledEntry,
} from "./claudePluginMarket";

export interface ClaudeLspBundleItemResult {
  ref: string;
  name: string;
}

export interface ClaudeLspBundleInstallResult {
  installed: ClaudeLspBundleItemResult[];
  skipped: ClaudeLspBundleItemResult[];
  failed: Array<ClaudeLspBundleItemResult & { error: string }>;
}

function bundleItem(entry: ClaudePluginCatalogEntry): ClaudeLspBundleItemResult {
  return { ref: claudePluginInstallRef(entry), name: entry.name };
}

export function countMissingClaudeLspCore(
  installed: readonly ClaudePluginInstalledEntry[],
): number {
  const installedIds = new Set(installed.map((row) => row.id));
  return getClaudeLspCoreCatalogEntries().filter(
    (entry) => !installedIds.has(claudePluginInstallRef(entry)),
  ).length;
}

/** 初始化市场并安装尚未安装的核心 LSP 插件（user 作用域）。 */
export async function installClaudeLspCoreBundle(): Promise<ClaudeLspBundleInstallResult> {
  await claudePluginMarketBootstrap();
  const installedRows = await claudePluginListInstalled();
  const installedIds = new Set(installedRows.map((row) => row.id));

  const result: ClaudeLspBundleInstallResult = {
    installed: [],
    skipped: [],
    failed: [],
  };

  for (const entry of getClaudeLspCoreCatalogEntries()) {
    const item = bundleItem(entry);
    if (installedIds.has(item.ref)) {
      result.skipped.push(item);
      continue;
    }
    try {
      await claudePluginInstall(item.ref, "user");
      installedIds.add(item.ref);
      result.installed.push(item);
    } catch (e) {
      result.failed.push({
        ...item,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export async function uninstallClaudeLspCoreBundle(): Promise<ClaudeLspBundleInstallResult> {
  const installedRows = await claudePluginListInstalled();
  const installedIds = new Set(installedRows.map((row) => row.id));

  const result: ClaudeLspBundleInstallResult = {
    installed: [],
    skipped: [],
    failed: [],
  };

  for (const entry of getClaudeLspCoreCatalogEntries()) {
    const item = bundleItem(entry);
    if (!installedIds.has(item.ref)) {
      result.skipped.push(item);
      continue;
    }
    try {
      await claudePluginUninstall(item.ref, "user");
      installedIds.delete(item.ref);
      result.installed.push(item);
    } catch (e) {
      result.failed.push({
        ...item,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export function formatClaudeLspBundleMessage(
  action: "install" | "uninstall",
  result: ClaudeLspBundleInstallResult,
): string {
  const verb = action === "install" ? "安装" : "卸载";
  if (result.failed.length > 0) {
    const names = result.failed.map((f) => f.name).join("、");
    return `${verb}部分失败：${names}`;
  }
  if (result.installed.length === 0 && result.skipped.length > 0) {
    return action === "install" ? "核心语言服务已全部安装" : "核心语言服务均未安装";
  }
  const names = result.installed.map((i) => i.name).join("、");
  return `已${verb}：${names}`;
}
