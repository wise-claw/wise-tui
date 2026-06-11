import { buildAssistantHubSections } from "../components/AssistantHubShared/groupAssistants";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  SESSION_QUICK_ACTION_CATALOG_ORDER,
  SESSION_QUICK_ACTION_META,
  type SessionQuickActionId,
  type SessionQuickActionMeta,
} from "../constants/sessionQuickActionsLayout";
import type { AssistantEntry } from "../types/assistant";

export interface SessionQuickActionCatalog {
  order: SessionQuickActionId[];
  meta: Record<string, SessionQuickActionMeta>;
}

const SYSTEM_ACTION_IDS = new Set<SessionQuickActionId>([
  "new-session",
  "push",
  "compact-context",
]);

function shortenAssistantPillLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "助手";
  return trimmed.replace(/助手$/, "").trim() || trimmed;
}

export function isAssistantTemplateQuickActionId(id: string): boolean {
  return id.startsWith("builtin:") || id.startsWith("custom:") || id.startsWith("ext-");
}

export function isSystemSessionQuickActionId(id: string): boolean {
  return SYSTEM_ACTION_IDS.has(id as SessionQuickActionId);
}

export function buildSessionQuickActionCatalog(
  assistants: readonly AssistantEntry[],
): SessionQuickActionCatalog {
  const meta: Record<string, SessionQuickActionMeta> = {
    ...SESSION_QUICK_ACTION_META,
  };
  const order: SessionQuickActionId[] = [];
  const seen = new Set<string>();

  const pushId = (id: SessionQuickActionId) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  for (const id of SESSION_QUICK_ACTION_CATALOG_ORDER) {
    if (isSystemSessionQuickActionId(id) || id in SESSION_QUICK_ACTION_META) {
      pushId(id);
    }
  }

  for (const section of buildAssistantHubSections([...assistants], "all")) {
    for (const assistant of section.assistants) {
      if (!meta[assistant.id]) {
        meta[assistant.id] = {
          id: assistant.id,
          label: assistant.name.trim() || assistant.id,
          pillLabel: shortenAssistantPillLabel(assistant.name),
        };
      }
      pushId(assistant.id);
    }
  }

  return { order, meta };
}

export function resolveSessionQuickActionMeta(
  id: SessionQuickActionId,
  catalog?: SessionQuickActionCatalog | null,
): SessionQuickActionMeta {
  return (
    catalog?.meta[id] ??
    SESSION_QUICK_ACTION_META[id as keyof typeof SESSION_QUICK_ACTION_META] ?? {
      id,
      label: id,
      pillLabel: id,
    }
  );
}

export function defaultQuickActionItemForId(id: SessionQuickActionId): {
  visible: boolean;
  zone: "primary" | "overflow";
} {
  const fromDefault = DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT.items.find((item) => item.id === id);
  if (fromDefault) {
    return { visible: fromDefault.visible, zone: fromDefault.zone };
  }
  if (isSystemSessionQuickActionId(id)) {
    return { visible: true, zone: "overflow" };
  }
  if (isAssistantTemplateQuickActionId(id)) {
    return {
      visible: true,
      zone: "overflow",
    };
  }
  return { visible: false, zone: "overflow" };
}
