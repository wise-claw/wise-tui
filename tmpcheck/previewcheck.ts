import fs from "fs";
import os from "os";
const raw = JSON.parse(fs.readFileSync(os.homedir() + "/.wise/tabs.json", "utf8"));
const { getSessionPreview } = await import("../src/components/ClaudeSessions/claudeChatHelpers");
const { resolveSessionListPreviewSource } = await import("../src/utils/sessionListPreview");
const list = raw.sessions.filter((s: any) => /wise-tui/.test(s.repositoryPath || ""));
list.sort((a: any, b: any) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
for (const s of list.slice(0, 8)) {
  console.log(JSON.stringify({ id: s.id, msgs: (s.messages||[]).length, diskPreview: (s.diskPreview||"").slice(0,30), resolved: String(resolveSessionListPreviewSource(s)).slice(0,30), preview: getSessionPreview(s) }));
}
