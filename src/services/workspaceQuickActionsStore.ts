import {
  mergeWorkspaceQuickActionsPayload,
  parseWorkspaceQuickActionsPayload,
  type WorkspaceQuickActionItem,
  type WorkspaceQuickActionsPayloadV1,
} from "../types/workspaceQuickActions";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

const PROJECT_KEY_PREFIX = "wise.workspaceQuickActions.project:" as const;
const REPOSITORY_KEY_PREFIX = "wise.workspaceQuickActions.repository:" as const;
const KEY_SUFFIX = ".v1" as const;

function projectKey(projectId: string): string {
  return `${PROJECT_KEY_PREFIX}${projectId.trim()}${KEY_SUFFIX}`;
}

function repositoryKey(repositoryId: number): string {
  return `${REPOSITORY_KEY_PREFIX}${repositoryId}${KEY_SUFFIX}`;
}

export async function loadProjectWorkspaceQuickActions(
  projectId: string,
): Promise<WorkspaceQuickActionsPayloadV1> {
  const id = projectId.trim();
  if (!id) return { version: 1, items: [] };
  return parseWorkspaceQuickActionsPayload(await getAppSetting(projectKey(id)));
}

export async function saveProjectWorkspaceQuickActions(
  projectId: string,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  const payload = mergeWorkspaceQuickActionsPayload(items);
  await setAppSettingJson(projectKey(id), payload);
}

export async function loadRepositoryWorkspaceQuickActions(
  repositoryId: number,
): Promise<WorkspaceQuickActionsPayloadV1> {
  if (!Number.isFinite(repositoryId)) return { version: 1, items: [] };
  return parseWorkspaceQuickActionsPayload(await getAppSetting(repositoryKey(repositoryId)));
}

export async function saveRepositoryWorkspaceQuickActions(
  repositoryId: number,
  items: WorkspaceQuickActionItem[],
): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  const payload = mergeWorkspaceQuickActionsPayload(items);
  await setAppSettingJson(repositoryKey(repositoryId), payload);
}

export async function deleteProjectWorkspaceQuickActions(projectId: string): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await deleteAppSetting(projectKey(id)).catch(() => {});
}

export async function deleteRepositoryWorkspaceQuickActions(repositoryId: number): Promise<void> {
  if (!Number.isFinite(repositoryId)) return;
  await deleteAppSetting(repositoryKey(repositoryId)).catch(() => {});
}
