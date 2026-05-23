import { invoke } from "@tauri-apps/api/core";

/** 写入用户通过保存对话框选择的绝对路径。 */
export async function writeTextFileAbsolute(path: string, contents: string): Promise<void> {
  await invoke("write_text_file_absolute", { path, contents });
}
