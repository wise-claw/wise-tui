/**
 * 将 `DEFAULT_SPLIT_PROMPT_LAYERS` 序列化为平台默认种子 JSON，
 * 供 `src-tauri/migrations/005_platform_split_prompt_seed.json` 与迁移写入 `app_settings`。
 *
 * 修改默认模板后运行：bun run scripts/emit-platform-split-prompt-seed.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SPLIT_PROMPT_LAYERS } from "../src/services/splitPromptTemplate";
import { PROMPT_SLOT_PRD_TASK_SPLIT, serializePromptBundle } from "../src/services/splitPromptBundle";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const outPath = join(root, "src-tauri/migrations/005_platform_split_prompt_seed.json");

const json = serializePromptBundle({ [PROMPT_SLOT_PRD_TASK_SPLIT]: DEFAULT_SPLIT_PROMPT_LAYERS });
writeFileSync(outPath, `${json}\n`, "utf8");
console.log("Wrote", outPath);
