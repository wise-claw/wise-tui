import { invoke } from "@tauri-apps/api/core";
import { trackAsyncOperation } from "../stores/operationWatchdogStore";
import { SKILLS_DETECT_TIMEOUT_MS, SKILLS_SCAN_TIMEOUT_MS } from "../utils/ipcTimeouts";

export type SkillSource = "builtin" | "custom" | "extension";

export interface DetectedExternalPath {
  id: string | null;
  path: string;
  exists: boolean;
  count: number;
  isDefault: boolean;
}

export interface ScannedSkill {
  name: string;
  location: string;
  isSymlink: boolean;
  hasSkillMd: boolean;
  source: SkillSource;
}

export interface SkillInstruction {
  id: string;
  sourcePath: string;
  skillPath: string;
  content: string;
}

export interface ExternalPathRow {
  id: string;
  path: string;
  addedAt: string;
}

export interface ImportedSkill {
  name: string;
  location: string;
  isSymlink: boolean;
}

export async function detectExternalSkillPaths(): Promise<DetectedExternalPath[]> {
  return trackAsyncOperation(
    "探测技能目录",
    invoke<DetectedExternalPath[]>("skills_detect_external_paths"),
    SKILLS_DETECT_TIMEOUT_MS,
  );
}

export async function scanSkillPath(path: string): Promise<ScannedSkill[]> {
  return trackAsyncOperation(
    "扫描技能",
    invoke<ScannedSkill[]>("skills_scan_path", { arg: { path } }),
    SKILLS_SCAN_TIMEOUT_MS,
  );
}

export async function readSkillInstruction(id: string, sourcePath: string): Promise<SkillInstruction> {
  return invoke<SkillInstruction>("skills_read_instruction", { arg: { id, sourcePath } });
}

export async function addExternalSkillPath(path: string): Promise<DetectedExternalPath> {
  return invoke<DetectedExternalPath>("skills_add_external_path", { arg: { path } });
}

export async function removeExternalSkillPath(id: string): Promise<void> {
  await invoke<void>("skills_remove_external_path", { arg: { id } });
}

export async function listExternalSkillPaths(): Promise<ExternalPathRow[]> {
  return invoke<ExternalPathRow[]>("skills_list_external_paths");
}

export async function importSkillCopy(sourcePath: string): Promise<ImportedSkill> {
  return invoke<ImportedSkill>("skills_import_copy", { arg: { sourcePath } });
}

export async function importSkillSymlink(sourcePath: string): Promise<ImportedSkill> {
  return invoke<ImportedSkill>("skills_import_symlink", { arg: { sourcePath } });
}

export async function deleteImportedSkill(name: string): Promise<void> {
  await invoke<void>("skills_delete_imported", { arg: { name } });
}

export async function exportSkillSymlink(sourcePath: string, destPath: string): Promise<void> {
  await invoke<void>("skills_export_symlink", { arg: { sourcePath, destPath } });
}

export async function getWiseSkillsHome(): Promise<string | null> {
  return invoke<string | null>("skills_wise_home");
}
