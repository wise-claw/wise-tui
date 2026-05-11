/** 仓库根路径 + 相对路径 → 绝对路径（用于系统打开等；相对路径中的 `/` 会按仓库根所用分隔符转换）。 */
export function joinRepositoryAbsolutePath(repositoryPath: string, relativePath: string): string {
  const base = repositoryPath.replace(/[/\\]+$/, "");
  const rel = relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const sep = base.includes("\\") ? "\\" : "/";
  const relNorm = sep === "\\" ? rel.replace(/\//g, "\\") : rel;
  return `${base}${sep}${relNorm}`;
}

/** 将标准 Base64 解码为 `ArrayBuffer`（供 PDF Blob、docx mammoth 等使用）。 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
