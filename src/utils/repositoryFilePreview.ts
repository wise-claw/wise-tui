const MONACO_SUPPORTED_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "log",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "sh",
  "bash",
  "zsh",
  "json",
  "jsonc",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "svg",
  "sql",
  "css",
  "less",
  "scss",
  "html",
  "vue",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "rb",
  "pl",
  "r",
]);

const MONACO_SUPPORTED_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".editorconfig",
  ".env",
  ".env.example",
  "readme",
  "license",
  "changelog",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

export type RepositoryBinaryPreviewState =
  | { kind: "image"; relativePath: string; src: string }
  | { kind: "pdf"; relativePath: string; blobUrl: string }
  | { kind: "docx"; relativePath: string; html: string }
  | { kind: "doc"; relativePath: string; absolutePath: string };

function getPathName(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

function getPathExt(path: string): string {
  const fileName = getPathName(path);
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot + 1);
}

export function isImageFilePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getPathExt(path));
}

export function mimeTypeForImagePath(path: string): string {
  const ext = getPathExt(path);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

export function isPdfFilePath(path: string): boolean {
  return getPathExt(path) === "pdf";
}

export function isDocxFilePath(path: string): boolean {
  return getPathExt(path) === "docx";
}

export function isLegacyDocFilePath(path: string): boolean {
  return getPathExt(path) === "doc";
}

export function isRepositoryBinaryPreviewPath(path: string): boolean {
  return (
    isImageFilePath(path) ||
    isPdfFilePath(path) ||
    isDocxFilePath(path) ||
    isLegacyDocFilePath(path)
  );
}

export function isMonacoSupportedFilePath(path: string): boolean {
  const fileName = getPathName(path);
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }
  if (MONACO_SUPPORTED_FILENAMES.has(fileName)) {
    return true;
  }
  const ext = getPathExt(path);
  return ext.length > 0 && MONACO_SUPPORTED_EXTENSIONS.has(ext);
}

export function monacoLanguageFromRepositoryPath(path: string | null): string {
  if (!path) return "plaintext";
  const fileName = getPathName(path);
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "plaintext";
  }
  const ext = getPathExt(path);
  if (["dockerfile", "makefile"].includes(fileName)) {
    return fileName === "dockerfile" ? "dockerfile" : "makefile";
  }
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["js", "mjs", "cjs", "jsx"].includes(ext)) return "javascript";
  if (["ts", "mts", "cts", "tsx"].includes(ext)) return "typescript";
  if (ext === "py") return "python";
  if (["sh", "bash", "zsh"].includes(ext)) return "shell";
  if (["json", "jsonc"].includes(ext)) return "json";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  if (ext === "toml") return "toml";
  if (["ini", "cfg", "conf"].includes(ext)) return "ini";
  if (ext === "xml" || ext === "svg") return "xml";
  if (ext === "sql") return "sql";
  if (["css", "less", "scss"].includes(ext)) return "css";
  if (ext === "html") return "html";
  if (ext === "vue") return "html";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  return "plaintext";
}
