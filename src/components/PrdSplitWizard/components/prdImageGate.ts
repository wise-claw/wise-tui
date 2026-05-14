/**
 * 纯函数辅助：与 React/DOM 无关，方便在 bun test 下覆盖。
 */

export const PRD_IMAGE_ACCEPTED_MIME_PREFIX = "image/";
export const PRD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export function isAcceptedImageMime(mime: string | null | undefined): boolean {
  return Boolean(mime && mime.startsWith(PRD_IMAGE_ACCEPTED_MIME_PREFIX));
}

export function sanitizeImageFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "image.png";
  const ascii = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  return ascii.length > 0 ? ascii : "image.png";
}

/**
 * @returns one of:
 *   - "ok"        允许落盘
 *   - "too-large" 超过 PRD_IMAGE_MAX_BYTES
 *   - "wrong-mime" 非 image/*
 */
export type PrdImageGate = "ok" | "too-large" | "wrong-mime";

export function gatePrdImage(file: { size: number; type: string }): PrdImageGate {
  if (!isAcceptedImageMime(file.type)) return "wrong-mime";
  if (file.size > PRD_IMAGE_MAX_BYTES) return "too-large";
  return "ok";
}
