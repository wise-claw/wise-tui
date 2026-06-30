import { describe, expect, test } from "bun:test";
import { polishComposerSpeechTranscript } from "./composerSpeechPolish";

// REQ2 闸口的可离线验证部分：无项目路径 / 空输入时，绝不返回原始转写，始终是整理后的文本。
describe("polishComposerSpeechTranscript (degrade paths)", () => {
  test("empty transcript yields empty", async () => {
    expect(await polishComposerSpeechTranscript("", "")).toBe("");
    expect(await polishComposerSpeechTranscript("/repo", "   ")).toBe("");
  });

  test("no project path degrades to local cleanup (never raw)", async () => {
    const out = await polishComposerSpeechTranscript("", "嗯嗯 帮我修一下");
    expect(out).toBe("帮我修一下");
    expect(out).not.toContain("嗯");
  });

  test("trivial short utterance stays local even with a project path (no LLM)", async () => {
    // 极短无口头语：本地整理足够，不触发 LLM（保流畅）。
    expect(await polishComposerSpeechTranscript("/repo", "好的")).toBe("好的");
  });
});
