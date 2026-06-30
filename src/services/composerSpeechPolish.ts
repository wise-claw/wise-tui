import { invoke } from "@tauri-apps/api/core";
import {
  applyLocalSpeechPolishFallback,
  buildComposerSpeechPolishPrompt,
  sanitizePolishedSpeechOutput,
} from "../utils/composerSpeechPolish";

const POLISH_TIMEOUT_MS = 12_000;
const POLISH_MODEL = "haiku";

/**
 * 极短且无口头语的转写（如「好的」「收到」「停」）：本地整理已足够，跳过 LLM 以保流畅。
 * 这是唯一的「跳过 LLM」判定，避免历史上 pipeline(>20) 与 service(<=24) 两套阈值打架。
 */
function isTrivialSpeechSegment(raw: string): boolean {
  if (raw.length > 8) return false;
  return !/(?:嗯|啊|呃|额|诶|那个|这个|就是|然后|怎么说|这样的话)/u.test(raw);
}

/**
 * 语音转写的统一后处理「闸口」：无论手动 / 自动发送，落到输入框的文本都先经过这里整理。
 * 始终返回已整理文本（LLM 优先，不可用 / 超时 / 报错 / 无项目路径时退化为本地整理），
 * 绝不返回未经处理的原始转写。
 */
export async function polishComposerSpeechTranscript(
  projectPath: string,
  rawTranscript: string,
): Promise<string> {
  const raw = rawTranscript.trim();
  if (!raw) return "";

  // 始终先算出本地整理结果，作为兜底（保证 REQ2：绝不写入原始转写）。
  const local = applyLocalSpeechPolishFallback(raw) || raw;

  const cwd = projectPath.trim();
  if (!cwd) return local;
  if (isTrivialSpeechSegment(raw)) return local;

  try {
    const out = await invoke<string>("run_claude_quick", {
      projectPath: cwd,
      prompt: buildComposerSpeechPolishPrompt(raw),
      timeoutMs: POLISH_TIMEOUT_MS,
      model: POLISH_MODEL,
    });
    return sanitizePolishedSpeechOutput(out, local);
  } catch {
    return local;
  }
}
