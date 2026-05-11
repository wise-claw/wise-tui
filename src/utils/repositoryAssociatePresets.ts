import type { Repository, RepositoryAssociatePreset } from "../types";
import { repositoryTypeChineseLabel } from "./repositoryType";

export function customPresetOptionValue(id: string): string {
  return `custom:${id}`;
}

export function isCustomPresetSelectValue(value: string): boolean {
  return value.startsWith("custom:");
}

export function presetFingerprint(
  input: Pick<RepositoryAssociatePreset, "repositoryType" | "iconDisplayName" | "iconColor">,
): string {
  return `${input.repositoryType}|${input.iconDisplayName.trim()}|${input.iconColor ?? ""}`;
}

export function formatRepositoryAssociatePresetLabel(p: RepositoryAssociatePreset): string {
  const t = p.iconDisplayName.trim();
  if (t.length > 0) {
    return t.length > 10 ? `${t.slice(0, 10)}…` : t;
  }
  return `${repositoryTypeChineseLabel(p.repositoryType)} · 默认角标`;
}

function isRepositoryType(v: unknown): v is Repository["repositoryType"] {
  return v === "frontend" || v === "backend" || v === "document";
}

export function normalizeRepositoryAssociatePresets(raw: unknown): RepositoryAssociatePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: RepositoryAssociatePreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.trim().length > 0 ? rec.id.trim() : null;
    if (!id) continue;
    if (!isRepositoryType(rec.repositoryType)) continue;
    const iconDisplayName = typeof rec.iconDisplayName === "string" ? rec.iconDisplayName : "";
    const iconColor =
      rec.iconColor === null || rec.iconColor === undefined
        ? null
        : typeof rec.iconColor === "string"
          ? rec.iconColor.trim() || null
          : null;
    const createdAt =
      typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now();
    out.push({
      id,
      repositoryType: rec.repositoryType,
      iconDisplayName,
      iconColor,
      createdAt,
    });
  }
  return out;
}

export function newRepositoryAssociatePresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
