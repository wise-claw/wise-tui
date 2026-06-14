import type { FitAddon, Ghostty, Terminal } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";

export type GhosttyModule = {
  Terminal: typeof Terminal;
  FitAddon: typeof FitAddon;
  ghostty: Ghostty;
};

let shared: Promise<GhosttyModule> | undefined;

/** 单例加载 ghostty-web WASM，供懒加载终端面板复用。 */
export function loadGhosttyModule(): Promise<GhosttyModule> {
  if (shared) return shared;
  shared = loadGhosttyModuleOnce();
  return shared;
}

async function loadGhosttyModuleOnce(): Promise<GhosttyModule> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const mod = await import("ghostty-web");
      const ghostty = await mod.Ghostty.load(wasmUrl);
      return {
        Terminal: mod.Terminal,
        FitAddon: mod.FitAddon,
        ghostty,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
  shared = undefined;
  throw lastError;
}
