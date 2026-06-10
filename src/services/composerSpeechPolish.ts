import { invoke } from "@tauri-apps/api/core";
import {
  applyLocalSpeechPolishFallback,
  buildComposerSpeechPolishPrompt,
  sanitizePolishedSpeechOutput,
} from "../utils/composerSpeechPolish";

const POLISH_TIMEOUT_MS = 12_000;
const POLISH_MODEL = "haiku";

export async function polishComposerSpeechTranscript(
  projectPath: string,
  rawTranscript: string,
): Promise<string> {
  const raw = rawTranscript.trim();
  if (!raw) return "";
  const local = applyLocalSpeechPolishFallback(raw);
  const cwd = projectPath.trim();
  if (!cwd) return local;
  if (!/(?:嗯|啊|呃|额|诶|那个|就是|然后|就是说|怎么说呢|这样的话)/u.test(raw) && raw.length <= 24) {
    return local;
  }

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
