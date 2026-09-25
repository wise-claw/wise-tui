import fs from "fs";
import os from "os";
const raw = JSON.parse(fs.readFileSync(os.homedir() + "/.wise/tabs.json", "utf8"));
const { getSessionUpdatedAt } = await import("../src/components/ClaudeSessions/sessionGrouping");
const list = raw.sessions.filter((s: any) => /wise-tui/.test(s.repositoryPath || ""));
const withT = list.map((s: any) => ({ s, t: getSessionUpdatedAt(s) }));
withT.sort((a: any, b: any) => b.t - a.t);
const now = Date.now();
for (const { s, t } of withT.slice(0, 8)) {
  const diff = now - t;
  const rel = diff < 45000 ? "刚刚" : diff < 3600000 ? `${Math.max(1, Math.floor(diff/60000))}m` : diff < 86400000 ? `${Math.floor(diff/3600000)}h` : `${Math.floor(diff/86400000)}d`;
  console.log([rel, s.id, (s.diskPreview||'').slice(0,24), 'msgs='+(s.messages||[]).length, s.status].join(' | '));
}
