import { invoke } from "@tauri-apps/api/core";
import type { ProjectItem, Repository } from "../types";

export async function updateRepositoryOpenAppId(
  id: number,
  openAppId: string | null,
): Promise<Repository> {
  return invoke<Repository>("update_repository_open_app_id", {
    id,
    openAppId,
  });
}

export async function updateProjectOpenAppId(
  projectId: string,
  openAppId: string | null,
): Promise<ProjectItem> {
  return invoke<ProjectItem>("update_project_open_app_id", {
    projectId,
    openAppId,
  });
}
