import "@vscode/codicons/dist/codicon.css";

// ── Types ──

export type ExplorerFolderVisualKind =
  | "src"
  | "components"
  | "assets"
  | "public"
  | "scripts"
  | "dist"
  | "node_modules"
  | "github"
  | "lib"
  | "default";

// ── Helpers ──

export function explorerFolderVisualKind(folderName: string): ExplorerFolderVisualKind {
  const n = folderName.toLowerCase();
  const map: Record<string, ExplorerFolderVisualKind> = {
    src: "src",
    components: "components",
    assets: "assets",
    public: "public",
    scripts: "scripts",
    dist: "dist",
    build: "dist",
    out: "dist",
    target: "dist",
    node_modules: "node_modules",
    ".github": "github",
    lib: "lib",
  };
  return map[n] ?? "default";
}

function fileExtLower(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) {
    return "";
  }
  return fileName.slice(i + 1).toLowerCase();
}

type FileIconResolve = { mode: "codicon"; codicon: string; kind: string } | { mode: "react"; kind: "tsx" };

function resolveExplorerFileIcon(fileName: string): FileIconResolve {
  if (/^(dockerfile|containerfile)$/i.test(fileName)) {
    return { mode: "codicon", codicon: "codicon-file-code", kind: "docker" };
  }
  const ext = fileExtLower(fileName);
  if (ext === "tsx" || ext === "jsx") {
    return { mode: "react", kind: "tsx" };
  }
  if (ext === "json" || ext === "jsonc") {
    return { mode: "codicon", codicon: "codicon-json", kind: "json" };
  }
  if (ext === "md" || ext === "mdx") {
    return { mode: "codicon", codicon: "codicon-markdown", kind: "markdown" };
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif", "heic", "svg"].includes(ext)) {
    return { mode: "codicon", codicon: "codicon-file-media", kind: "media" };
  }
  if (["zip", "gz", "tgz", "rar", "7z", "tar", "bz2", "xz"].includes(ext)) {
    return { mode: "codicon", codicon: "codicon-file-zip", kind: "zip" };
  }
  if (ext === "pdf") {
    return { mode: "codicon", codicon: "codicon-file-pdf", kind: "pdf" };
  }
  if (["rs", "toml", "yaml", "yml", "css", "scss", "less", "html", "htm", "vue", "svelte", "go", "py", "rb", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "sql", "sh", "bash", "zsh", "ps1"].includes(ext)) {
    return { mode: "codicon", codicon: "codicon-file-code", kind: ext };
  }
  if (["ts", "mts", "cts"].includes(ext)) {
    return { mode: "codicon", codicon: "codicon-file-code", kind: "ts" };
  }
  if (["js", "mjs", "cjs"].includes(ext)) {
    return { mode: "codicon", codicon: "codicon-file-code", kind: "js" };
  }
  if (ext === "lock" || fileName.endsWith(".lock")) {
    return { mode: "codicon", codicon: "codicon-file", kind: "lock" };
  }
  if (!ext) {
    return { mode: "codicon", codicon: "codicon-file", kind: "plain" };
  }
  return { mode: "codicon", codicon: "codicon-symbol-file", kind: "generic" };
}

// ── Sub-components / SVG Icons ──

function IconReactSourceFile() {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden className="explorer-tree-react-icon">
      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
      <ellipse
        cx="8"
        cy="8"
        rx="6.2"
        ry="2.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        transform="rotate(-54 8 8)"
      />
      <ellipse
        cx="8"
        cy="8"
        rx="6.2"
        ry="2.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        transform="rotate(54 8 8)"
      />
      <ellipse
        cx="8"
        cy="8"
        rx="6.2"
        ry="2.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
      />
    </svg>
  );
}

// ── Tree chrome (VS Code codicons + Seti-like tints) ──

interface ExplorerTreeChevronProps {
  className?: string;
}

/** VS Code 资源管理器折叠箭头：codicon chevron-right，展开时由外层旋转 90° */
export function ExplorerTreeChevron({ className }: ExplorerTreeChevronProps) {
  return <span className={["codicon codicon-chevron-right", className].filter(Boolean).join(" ")} aria-hidden />;
}

interface ExplorerTreeFolderIconProps {
  name: string;
  expanded: boolean;
  className?: string;
}

export function ExplorerTreeFolderIcon({ name, expanded, className }: ExplorerTreeFolderIconProps) {
  const kind = explorerFolderVisualKind(name);
  const codicon = expanded ? "codicon-folder-opened" : "codicon-folder";
  return (
    <span
      className={[
        "explorer-tree-folder-icon codicon",
        codicon,
        `explorer-tree-folder-icon--${kind}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    />
  );
}

interface ExplorerTreeFileIconProps {
  fileName: string;
  className?: string;
}

export function ExplorerTreeFileIcon({ fileName, className }: ExplorerTreeFileIconProps) {
  const resolved = resolveExplorerFileIcon(fileName);
  if (resolved.mode === "react") {
    return (
      <span
        className={["explorer-tree-file-icon explorer-tree-file-icon--react", className].filter(Boolean).join(" ")}
        aria-hidden
      >
        <IconReactSourceFile />
      </span>
    );
  }
  return (
    <span
      className={[
        "explorer-tree-file-icon codicon",
        resolved.codicon,
        `explorer-tree-file-icon--${resolved.kind}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    />
  );
}
