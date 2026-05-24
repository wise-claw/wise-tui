import { describe, expect, test } from "bun:test";
import {
  parseCodexProfileEnvelopeJson,
  serializeCodexProfileEnvelope,
  validateCodexProfileDraft,
} from "./codexProfileEnvelope";

describe("codexProfileEnvelope", () => {
  test("round-trips auth json and config toml separately", () => {
    const raw = JSON.stringify({
      auth: { OPENAI_API_KEY: "sk-test", auth_mode: "apikey" },
      config: 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n',
    });
    const draft = parseCodexProfileEnvelopeJson(raw);
    expect(draft.authJson).toContain('"OPENAI_API_KEY"');
    expect(draft.configToml).toBe('model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n');

    const merged = serializeCodexProfileEnvelope(draft);
    const again = parseCodexProfileEnvelopeJson(merged);
    expect(JSON.parse(again.authJson)).toEqual(JSON.parse(draft.authJson));
    expect(again.configToml).toBe(draft.configToml);
  });

  test("validates auth json object", () => {
    expect(
      validateCodexProfileDraft({
        authJson: "[]",
        configToml: "",
      }),
    ).toBe("auth 必须是 JSON 对象");
  });
});
