import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../../types/assistant";
import {
  buildCollabAgentInitialConfig,
  COLLAB_AGENT_TEMPLATES,
  collabTemplateHash,
  isCollabTemplateOutdated,
} from "./agentTemplates";

const assistant: AssistantEntry = {
  id: "custom:order",
  source: "custom",
  name: "订单助手",
  description: "",
  avatarColor: "#123456",
  engineId: "codex",
  model: "gpt-x",
  systemPrompt: "你是订单助手",
  defaultSkills: [{ id: "review", label: "代码评审", sourcePath: "/skills/review" }, { id: " ", label: "空" }],
  defaultMcps: [{ id: "jira", label: "Jira" }],
};

describe("collab agent templates", () => {
  test("template ids are unique and hash is stable", () => {
    const ids = COLLAB_AGENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const t = COLLAB_AGENT_TEMPLATES[0];
    expect(collabTemplateHash(t)).toBe(collabTemplateHash({ soulMd: t.soulMd, agentsMd: t.agentsMd }));
    expect(collabTemplateHash(t)).not.toBe(collabTemplateHash({ soulMd: `${t.soulMd}!`, agentsMd: t.agentsMd }));
  });

  test("template copies content and records hash", () => {
    const cfg = buildCollabAgentInitialConfig({ templateId: "backend" });
    expect(cfg.templateId).toBe("backend");
    expect(cfg.soulMd).toContain("后端服务智能体");
    expect(isCollabTemplateOutdated({ templateId: "backend", templateHash: cfg.templateHash ?? null })).toBe(false);
    expect(isCollabTemplateOutdated({ templateId: "backend", templateHash: "deadbeef" })).toBe(true);
    expect(isCollabTemplateOutdated({ templateId: "removed", templateHash: "deadbeef" })).toBe(false);
    expect(isCollabTemplateOutdated({ templateId: null, templateHash: null })).toBe(false);
  });

  test("assistant baseline copies skills/mcps/model; explicit engine wins", () => {
    const cfg = buildCollabAgentInitialConfig({ assistant, engineId: "claude" });
    expect(cfg.soulMd).toBe("你是订单助手");
    expect(cfg.skillBindings?.map((s) => s.id)).toEqual(["review"]);
    expect(cfg.skillBindings?.[0].sourcePath).toBe("/skills/review");
    expect(cfg.mcpBindings?.map((m) => m.serverId)).toEqual(["jira"]);
    expect(cfg.model).toBe("gpt-x");
    expect(cfg.engineId).toBe("claude");
    expect(cfg.templateId).toBeUndefined();
  });

  test("template soul wins over assistant prompt", () => {
    const cfg = buildCollabAgentInitialConfig({ templateId: "qa", assistant });
    expect(cfg.soulMd).toContain("测试验收智能体");
    expect(cfg.engineId).toBe("codex");
  });
});
