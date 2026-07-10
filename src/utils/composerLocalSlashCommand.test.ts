import { describe, expect, test } from "bun:test";
import {
  isClaudeNativeSlashCommandText,
  isComposerLocalSlashEligible,
  parseComposerLocalSlashCommand,
  parseComposerPluginSlashCommand,
  resolveComposerPluginInstallRef,
  extractClaudeNativeSlashCommandForOutbound,
} from "./composerLocalSlashCommand";

describe("parseComposerPluginSlashCommand", () => {
  test("parses list", () => {
    expect(parseComposerPluginSlashCommand("/plugin list")).toEqual({
      action: "list",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin")).toEqual({
      action: "list",
      scope: "user",
    });
  });

  test("parses install aliases and scope", () => {
    expect(parseComposerPluginSlashCommand("/plugin install oh-my-claudecode@omc --scope user")).toEqual({
      action: "install",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin i oh-my-claudecode@omc")).toEqual({
      action: "install",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
  });

  test("parses marketplace add and update", () => {
    expect(parseComposerPluginSlashCommand("/plugin marketplace add Yeachan-Heo/oh-my-claudecode")).toEqual({
      action: "marketplace_add",
      scope: "user",
      marketplaceSource: "Yeachan-Heo/oh-my-claudecode",
    });
    expect(
      parseComposerPluginSlashCommand(
        "/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode",
      ),
    ).toEqual({
      action: "marketplace_add",
      scope: "user",
      marketplaceSource: "https://github.com/Yeachan-Heo/oh-my-claudecode",
    });
    expect(parseComposerPluginSlashCommand("/plugin marketplace update")).toEqual({
      action: "marketplace_update",
      scope: "user",
    });
  });

  test("falls back to generic cli passthrough", () => {
    expect(parseComposerPluginSlashCommand("/plugin marketplace list")).toEqual({
      action: "cli",
      scope: "user",
      cliArgs: ["marketplace", "list"],
    });
    expect(parseComposerPluginSlashCommand("/plugin search foo")).toEqual({
      action: "cli",
      scope: "user",
      cliArgs: ["search", "foo"],
    });
  });

  test("parses uninstall and enable/disable", () => {
    expect(parseComposerPluginSlashCommand("/plugin uninstall oh-my-claudecode@omc")).toEqual({
      action: "uninstall",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin remove oh-my-claudecode@omc")).toEqual({
      action: "uninstall",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin enable oh-my-claudecode@omc")).toEqual({
      action: "enable",
      installRef: "oh-my-claudecode@omc",
      scope: "user",
    });
    expect(parseComposerPluginSlashCommand("/plugin disable oh-my-claudecode@omc --scope project")).toEqual({
      action: "disable",
      installRef: "oh-my-claudecode@omc",
      scope: "project",
    });
  });
});

describe("parseComposerLocalSlashCommand", () => {
  test("parses plugin via local wrapper", () => {
    expect(parseComposerLocalSlashCommand("/plugin install oh-my-claudecode")?.kind).toBe("plugin");
  });

  test("parses marketplace add as local plugin command", () => {
    const cmd = parseComposerLocalSlashCommand("/plugin marketplace add foo");
    expect(cmd?.kind).toBe("plugin");
    expect(cmd?.plugin?.action).toBe("marketplace_add");
    expect(cmd?.plugin?.marketplaceSource).toBe("foo");
  });

  test("parses compact context and clear", () => {
    expect(parseComposerLocalSlashCommand("/compact keep tests")).toEqual({
      kind: "compact",
      raw: "/compact keep tests",
    });
    expect(parseComposerLocalSlashCommand("/context")?.kind).toBe("context");
    expect(parseComposerLocalSlashCommand("/context all")).toEqual({
      kind: "context",
      raw: "/context all",
      contextDetailed: true,
    });
    expect(parseComposerLocalSlashCommand("/clear")?.kind).toBe("clear");
  });

  test("parses mcp skills hooks agents status", () => {
    expect(parseComposerLocalSlashCommand("/mcp")?.kind).toBe("mcp");
    expect(parseComposerLocalSlashCommand("/skills")?.kind).toBe("skills");
    expect(parseComposerLocalSlashCommand("/hooks list")?.kind).toBe("hooks");
    expect(parseComposerLocalSlashCommand("/agents list")?.kind).toBe("agents");
    expect(parseComposerLocalSlashCommand("/status")?.kind).toBe("status");
  });

  test("redirects unsupported mcp subcommands", () => {
    expect(parseComposerLocalSlashCommand("/mcp add foo")?.kind).toBe("redirect");
  });

  test("redirects known TUI-only commands", () => {
    expect(parseComposerLocalSlashCommand("/agents")?.kind).toBe("agents");
    expect(parseComposerLocalSlashCommand("/agents running")?.kind).toBe("redirect");
    expect(parseComposerLocalSlashCommand("/permissions")?.kind).toBe("redirect");
    expect(parseComposerLocalSlashCommand("/resume")?.kind).toBe("redirect");
  });

  test("returns null for inline or unknown commands", () => {
    expect(parseComposerLocalSlashCommand("请执行 /plugin install x")).toBeNull();
    expect(parseComposerLocalSlashCommand("/unknown-cmd")).toBeNull();
  });

  test("parses /ultracode 三种语义", () => {
    // 纯 toggle
    expect(parseComposerLocalSlashCommand("/ultracode")).toEqual({
      kind: "ultracode",
      raw: "/ultracode",
      ultracodePrompt: null,
    });
    // 显式 off
    expect(parseComposerLocalSlashCommand("/ultracode off")).toEqual({
      kind: "ultracode",
      raw: "/ultracode off",
      ultracodePrompt: "",
    });
    // 启用 + 携带 prompt
    expect(parseComposerLocalSlashCommand("/ultracode 帮我调研 X 的性能瓶颈")).toEqual({
      kind: "ultracode",
      raw: "/ultracode 帮我调研 X 的性能瓶颈",
      ultracodePrompt: "帮我调研 X 的性能瓶颈",
    });
    // 大小写不敏感（命令名 / 关键字）
    expect(parseComposerLocalSlashCommand("/UltraCode")?.kind).toBe("ultracode");
    expect(parseComposerLocalSlashCommand("/ultracode OFF")?.ultracodePrompt).toBe("");
  });

  test("ultracode typo 与相似前缀不误判", () => {
    // 拼错前缀 → 走原生 slash 兜底（返回 null，不进入本地拦截）
    expect(parseComposerLocalSlashCommand("/ultracodex")).toBeNull();
    expect(parseComposerLocalSlashCommand("/ultra")).toBeNull();
    // 嵌入行内的 /ultracode 不算命令（要求整行）
    expect(parseComposerLocalSlashCommand("请执行 /ultracode")).toBeNull();
  });
});

describe("isComposerLocalSlashEligible", () => {
  test("requires plain text only", () => {
    expect(
      isComposerLocalSlashEligible({
        text: "/help",
        imageCount: 0,
        contextCount: 0,
        codeSelectionRefCount: 0,
      }),
    ).toBe(true);
    expect(
      isComposerLocalSlashEligible({
        text: "/help",
        imageCount: 1,
      }),
    ).toBe(false);
  });
});

describe("isClaudeNativeSlashCommandText", () => {
  test("detects plugin slash commands and excludes Wise-local ones", () => {
    expect(isClaudeNativeSlashCommandText("/loom:init")).toBe(true);
    expect(isClaudeNativeSlashCommandText("/help")).toBe(false);
    expect(isClaudeNativeSlashCommandText("hello")).toBe(false);
  });

  test("detects slash after @ mention prefix", () => {
    expect(isClaudeNativeSlashCommandText("@终端01 /loom:init")).toBe(true);
    expect(isClaudeNativeSlashCommandText("@终端01 你好")).toBe(false);
  });
});

describe("extractClaudeNativeSlashCommandForOutbound", () => {
  test("strips mention prefix and keeps first slash line", () => {
    expect(extractClaudeNativeSlashCommandForOutbound("@foo /loom:init")).toBe("/loom:init");
    expect(extractClaudeNativeSlashCommandForOutbound("/loom:init\nextra")).toBe("/loom:init");
    expect(extractClaudeNativeSlashCommandForOutbound("/help")).toBeNull();
  });
});

describe("resolveComposerPluginInstallRef", () => {
  test("resolves catalog shorthand", () => {
    expect(resolveComposerPluginInstallRef("oh-my-claudecode")).toBe("oh-my-claudecode@omc");
  });

  test("throws for unknown shorthand", () => {
    expect(() => resolveComposerPluginInstallRef("not-a-real-plugin")).toThrow(/未找到插件/);
  });
});

// resolveUltracodeToggleDecision 的完整测试放在服务层；此处只覆盖显式分支的接口契约。
import { resolveUltracodeToggleDecision } from "../services/composerLocalSlashCommand";

describe("resolveUltracodeToggleDecision", () => {
  test("显式 off → next=false", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode off", ultracodePrompt: "" },
      session: { ultracodeEnabled: undefined },
      globalUltracodeEnabled: true,
    });
    expect(decision).toEqual({ next: false, prompt: null });
  });

  test("携带 prompt → next=true + prompt", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode 调研 X", ultracodePrompt: "调研 X" },
      session: { ultracodeEnabled: false },
      globalUltracodeEnabled: false,
    });
    expect(decision).toEqual({ next: true, prompt: "调研 X" });
  });

  test("纯 toggle：当前 override=true → 切到 null（清除）", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode", ultracodePrompt: null },
      session: { ultracodeEnabled: true },
      globalUltracodeEnabled: false,
    });
    expect(decision).toEqual({ next: null, prompt: null });
  });

  test("纯 toggle：当前 override=false → 切到 true", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode", ultracodePrompt: null },
      session: { ultracodeEnabled: false },
      globalUltracodeEnabled: true,
    });
    expect(decision).toEqual({ next: true, prompt: null });
  });

  test("纯 toggle：override 未设、global=true → 切到 null（无法在本会话关掉全局）", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode", ultracodePrompt: null },
      session: { ultracodeEnabled: undefined },
      globalUltracodeEnabled: true,
    });
    expect(decision).toEqual({ next: null, prompt: null });
  });

  test("纯 toggle：override 未设、global=false → 切到 true", () => {
    const decision = resolveUltracodeToggleDecision({
      command: { kind: "ultracode", raw: "/ultracode", ultracodePrompt: null },
      session: null,
      globalUltracodeEnabled: false,
    });
    expect(decision).toEqual({ next: true, prompt: null });
  });
});
