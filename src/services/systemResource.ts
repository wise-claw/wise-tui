import { invoke } from "@tauri-apps/api/core";
import type { SystemResourceSnapshot } from "../types";

export async function getSystemResourceSnapshot(): Promise<SystemResourceSnapshot> {
  return invoke<SystemResourceSnapshot>("get_system_resource_snapshot");
}
