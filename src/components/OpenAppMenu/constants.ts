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

export const DEFAULT_OPEN_APP_TARGETS: OpenAppTarget[] = isMacPlatform()
  ? [
      { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code", args: [] },
      { id: "cursor", label: "Cursor", kind: "app", appName: "Cursor", args: [] },
      { id: "finder", label: fileManagerName(), kind: "finder", args: [] },
      { id: "terminal", label: "Terminal", kind: "app", appName: "Terminal", args: [] },
      { id: "ghostty", label: "Ghostty", kind: "app", appName: "Ghostty", args: [] },
      { id: "intellij", label: "IntelliJ IDEA", kind: "app", appName: "IntelliJ IDEA", args: [] },
    ]
  : [
      { id: "vscode", label: "VS Code", kind: "command", command: "code", args: [] },
      { id: "cursor", label: "Cursor", kind: "command", command: "cursor", args: [] },
      { id: "finder", label: fileManagerName(), kind: "finder", args: [] },
      { id: "terminal", label: "Terminal", kind: "command", command: "gnome-terminal", args: [] },
      { id: "ghostty", label: "Ghostty", kind: "command", command: "ghostty", args: [] },
      { id: "intellij", label: "IntelliJ IDEA", kind: "command", command: "idea", args: [] },
    ];
