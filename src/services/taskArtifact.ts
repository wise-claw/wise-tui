/**
 * Task artifact IPC: 读写 `.trellis/tasks/<dir>/{prd,design,implement}.md`。
 *
 * 后端在 `src-tauri/src/task_artifact.rs` 校验路径必须落在合法 task 目录下,
 * 并且只允许这三种文件名。前端不重复校验,只透传 `repoRoot / taskDir / kind`。
 *
 * Wave B 第 1 件只用 `readTaskArtifact`(ArtifactPane 只读渲染);
 * `writeTaskArtifact` 暴露接口供后续助手 tool use(`update_prd / update_design /
 * update_implement`)与提交编辑 UI 调用。
 */
import { invoke } from "@tauri-apps/api/core";

export type TaskArtifactKind = "prd" | "design" | "implement";

export interface TaskArtifactPayload {
  taskDir: string;
  kind: TaskArtifactKind;
  markdown: string;
  exists: boolean;
}

export interface ReadTaskArtifactArgs {
  repoRoot: string;
  taskDir: string;
  kind: TaskArtifactKind;
}

export interface WriteTaskArtifactArgs extends ReadTaskArtifactArgs {
  markdown: string;
}

export async function readTaskArtifact(
  args: ReadTaskArtifactArgs,
): Promise<TaskArtifactPayload> {
  return invoke<TaskArtifactPayload>("read_task_artifact", { args });
}

export async function writeTaskArtifact(
  args: WriteTaskArtifactArgs,
): Promise<TaskArtifactPayload> {
  return invoke<TaskArtifactPayload>("write_task_artifact", { args });
}
