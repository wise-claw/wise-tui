import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "../services/openAppPreference";
import type { OpenAppTarget } from "../types";

/** 解析作用域覆盖后的有效 openApp id（null/空 = 跟随全局）。 */
export function resolveEffectiveOpenAppId(scopeOpenAppId?: string | null): string {
  const scoped = scopeOpenAppId?.trim();
  if (scoped) return scoped;
  return getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
}

export function resolveOpenAppTargetById(
  openAppId: string | undefined | null,
  openTargets: readonly OpenAppTarget[] = DEFAULT_OPEN_APP_TARGETS,
): OpenAppTarget | null {
  const effectiveId = resolveEffectiveOpenAppId(openAppId);
  return openTargets.find((item) => item.id === effectiveId) ?? openTargets[0] ?? null;
}

export function repositoryEditorOpenMenuLabel(scopeOpenAppId?: string | null): string {
  const target = resolveOpenAppTargetById(scopeOpenAppId);
  return target ? `在 ${target.label} 中打开` : "编辑器打开";
}

export const OPEN_APP_MENU_KEY_PREFIX = "open-app-";
export const OPEN_APP_MENU_KEY_DEFAULT = "open-app-default";

/** 解析「配置打开方式」子菜单 key；`default` 表示清除覆盖。 */
export function parseOpenAppConfigureMenuKey(key: string): string | null | undefined {
  if (key === OPEN_APP_MENU_KEY_DEFAULT) return null;
  if (!key.startsWith(OPEN_APP_MENU_KEY_PREFIX)) return undefined;
  const id = key.slice(OPEN_APP_MENU_KEY_PREFIX.length).trim();
  return id || null;
}

export function buildOpenAppConfigureMenuChildren(
  scopeOpenAppId?: string | null,
  openTargets: readonly OpenAppTarget[] = DEFAULT_OPEN_APP_TARGETS,
): Array<{ key: string; label: string }> {
  const scoped = scopeOpenAppId?.trim() || null;
  const globalId = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  const followGlobalSelected = !scoped;
  const children: Array<{ key: string; label: string }> = [
    {
      key: OPEN_APP_MENU_KEY_DEFAULT,
      label: followGlobalSelected ? "✓ 跟随全局默认" : "跟随全局默认",
    },
  ];
  for (const target of openTargets) {
    const selected = scoped ? scoped === target.id : target.id === globalId;
    children.push({
      key: `${OPEN_APP_MENU_KEY_PREFIX}${target.id}`,
      label: selected ? `✓ ${target.label}` : target.label,
    });
  }
  return children;
}
