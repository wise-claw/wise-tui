import {
  mergeWorkspaceMemosPayload,
  parseWorkspaceMemosPayload,
  type WorkspaceMemoItem,
  type WorkspaceMemosPayloadV1,
} from "../types/workspaceMemos";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

const PROJECT_KEY_PREFIX = "wise.workspaceMemos.project:" as const;
const REPOSITORY_KEY_PREFIX = "wise.workspaceMemos.repository:" as const;
const KEY_SUFFIX = ".v1" as const;

function projectKey(projectId: string): string {
  return `${PROJECT_KEY_PREFIX}${projectId.trim()}${KEY_SUFFIX}`;
}

function repositoryKey(repositoryId: number): string {
  return `${REPOSITORY_KEY_PREFIX}${repositoryId}${KEY_SUFFIX}`;
}

export async function loadProjectWorkspaceMemos(projectId: string): Promise<WorkspaceMemosPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  return parseWorkspaceMemosPayload(await getAppSetting(projectKey(id)));
}

export async function saveProjectWorkspaceMemos(
  projectId: string,
  items: WorkspaceMemoItem[],
  lastSelectedId?: string | null,
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await setAppSettingJson(projectKey(id), mergeWorkspaceMemosPayload(items, lastSelectedId));
}

export async function loadRepositoryWorkspaceMemos(
  repositoryId: number,
): Promise<WorkspaceMemosPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  return parseWorkspaceMemosPayload(await getAppSetting(repositoryKey(repositoryId)));
}

export async function saveRepositoryWorkspaceMemos(
  repositoryId: number,
  items: WorkspaceMemoItem[],
  lastSelectedId?: string | null,
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await setAppSettingJson(repositoryKey(repositoryId), mergeWorkspaceMemosPayload(items, lastSelectedId));
}

export async function deleteProjectWorkspaceMemos(projectId: string): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await deleteAppSetting(projectKey(id)).catch(() => {});
}

export async function deleteRepositoryWorkspaceMemos(repositoryId: number): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await deleteAppSetting(repositoryKey(repositoryId)).catch(() => {});
}
