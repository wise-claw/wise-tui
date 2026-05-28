import type { OpenAppTarget } from "../../types";

export const OPEN_APP_STORAGE_KEY = "open-workspace-app";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toLowerCase().includes("mac");
}

function fileManagerName(): string {
  return isMacPlatform() ? "Finder" : "Explorer";
}

export const DEFAULT_OPEN_APP_ID = isMacPlatform() ? "vscode" : "finder";

/** macOS 终端项由 `macos_detect_terminals` 动态注入，此处仅保留 IDE / 文件管理器。 */
export const MAC_BASE_OPEN_APP_TARGETS: OpenAppTarget[] = [
  { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code", args: [] },
  { id: "cursor", label: "Cursor", kind: "app", appName: "Cursor", args: [] },
  { id: "finder", label: fileManagerName(), kind: "finder", args: [] },
  { id: "intellij", label: "IntelliJ IDEA", kind: "app", appName: "IntelliJ IDEA", args: [] },
];

export const DEFAULT_OPEN_APP_TARGETS: OpenAppTarget[] = isMacPlatform()
  ? MAC_BASE_OPEN_APP_TARGETS
  : [
      { id: "vscode", label: "VS Code", kind: "command", command: "code", args: [] },
      { id: "cursor", label: "Cursor", kind: "command", command: "cursor", args: [] },
      { id: "finder", label: fileManagerName(), kind: "finder", args: [] },
      { id: "terminal", label: "Terminal", kind: "command", command: "gnome-terminal", args: [] },
      { id: "ghostty", label: "Ghostty", kind: "command", command: "ghostty", args: [] },
      { id: "intellij", label: "IntelliJ IDEA", kind: "command", command: "idea", args: [] },
    ];
