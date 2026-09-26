import { invoke } from "@tauri-apps/api/core";
import type { NativeCliDiskSessionItem, NativeCliEngine } from "../types";

/**
 * 列出外部 CLI 自己的会话索引。
 *
 * - `codex`：`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<id>.jsonl`（`codex exec` 一次性运行不计入）
 * - `deepseek`：`~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd`（含分片变体）
 * - `cursor`：`~/.cursor/acp-sessions/<agent-id>/meta.json` 及 `~/.cursor/projects/<repo>/agent-transcripts`
 *
 * 原生索引只在后台补充列表，失败时调用方按「无外部会话」处理。
 */
export async function listNativeCliDiskSessions(
  engine: NativeCliEngine,
  repositoryPath: string,
): Promise<NativeCliDiskSessionItem[]> {
  return invoke<NativeCliDiskSessionItem[]>("list_native_cli_disk_sessions", {
    engine,
    projectPath: repositoryPath,
  });
}

export type LoadNativeCliSessionTranscriptOptions = {
  /** 仅读取末尾若干行；不传或 `null` 表示读全量（仍受后端上限保护）。 */
  tailLines?: number | null;
};

/**
 * 读回原生会话转录，并在 Rust 侧转换成 Wise 前端已支持的流式行。
 *
 * 首行会带上 `codex_session` / `deepseek_session` 绑定行，让会话标签继续以原生 id 续接。
 */
export async function loadNativeCliSessionTranscript(
  engine: NativeCliEngine,
  repositoryPath: string,
  sessionId: string,
  options?: LoadNativeCliSessionTranscriptOptions,
): Promise<string[]> {
  const tailLines =
    typeof options?.tailLines === "number" && options.tailLines > 0
      ? Math.floor(options.tailLines)
      : null;
  return invoke<string[]>("load_native_cli_session_transcript", {
    engine,
    projectPath: repositoryPath,
    sessionId,
    tailLines,
  });
}
