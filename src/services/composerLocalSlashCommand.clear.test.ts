import { describe, expect, test } from "bun:test";
import { executeComposerLocalSlashCommand, composerLocalSlashPendingMessage } from "./composerLocalSlashCommand";
import { parseComposerLocalSlashCommand } from "../utils/composerLocalSlashCommand";

describe("clear current conversation", () => {
  test("clear and reset clear only the supplied session, new creates a session", async () => {
    const cleared: string[] = [];
    let created = 0;
    const deps = {
      sessionId: "existing-session", repositoryPath: "/repo",
      clearSessionHistory: (id: string) => { cleared.push(id); },
      createNewSession: () => { created++; },
    };
    for (const text of ["/clear", "/reset"]) {
      const command = parseComposerLocalSlashCommand(text, "codex-rpc")!;
      expect(composerLocalSlashPendingMessage(command)).toBeNull();
      expect(await executeComposerLocalSlashCommand(command, deps)).toBeNull();
    }
    expect(cleared).toEqual(["existing-session", "existing-session"]);
    expect(created).toBe(0);
    await executeComposerLocalSlashCommand(parseComposerLocalSlashCommand("/new", "codex-rpc")!, deps);
    expect(created).toBe(1);
  });
  test("does not fall back to creating a session when clearing is unavailable", async () => {
    let created = false;
    await expect(executeComposerLocalSlashCommand({ kind: "clear", raw: "/clear" }, {
      sessionId: "existing", repositoryPath: "/repo", createNewSession: () => { created = true; },
    })).rejects.toThrow("当前环境不支持 /clear");
    expect(created).toBe(false);
  });
});
