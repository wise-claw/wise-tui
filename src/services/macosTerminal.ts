import { invoke } from "@tauri-apps/api/core";
import type { OpenAppTarget } from "../types";

export interface DetectedMacTerminal {
  id: string;
  label: string;
  appName: string;
}

export const MAC_TERMINAL_OPEN_APP_IDS = [
  "terminal",
  "iterm",
  "ghostty",
  "warp",
  "kitty",
  "alacritty",
  "wezterm",
  "hyper",
] as const;

export type MacTerminalOpenAppId = (typeof MAC_TERMINAL_OPEN_APP_IDS)[number];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toLowerCase().includes("mac");
}

export function isTerminalOpenAppId(id: string): boolean {
  return (MAC_TERMINAL_OPEN_APP_IDS as readonly string[]).includes(id);
}

export function detectedMacTerminalToOpenTarget(terminal: DetectedMacTerminal): OpenAppTarget {
  return {
    id: terminal.id,
    label: terminal.label,
    kind: "app",
    appName: terminal.appName,
    args: [],
  };
}

export async function detectMacosTerminals(): Promise<DetectedMacTerminal[]> {
  if (!isMacPlatform()) return [];
  try {
    const rows = await invoke<DetectedMacTerminal[]>("macos_detect_terminals");
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("macos_detect_terminals failed", err);
    return [];
  }
}

let detectedCache: DetectedMacTerminal[] | null = null;
let detectPromise: Promise<DetectedMacTerminal[]> | null = null;

export function getDetectedMacTerminalsSync(): readonly DetectedMacTerminal[] {
  return detectedCache ?? [];
}

export async function ensureMacTerminalsDetected(): Promise<DetectedMacTerminal[]> {
  if (!isMacPlatform()) {
    detectedCache = [];
    return [];
  }
  if (detectedCache) return detectedCache;
  if (!detectPromise) {
    detectPromise = detectMacosTerminals().then((rows) => {
      detectedCache = rows;
      detectPromise = null;
      return rows;
    });
  }
  return detectPromise;
}

/** 测试或重新扫描时清空缓存。 */
export function resetMacTerminalDetectionCache(): void {
  detectedCache = null;
  detectPromise = null;
}
