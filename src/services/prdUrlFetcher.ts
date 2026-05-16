import { invoke } from "@tauri-apps/api/core";
import { validatePrdUrl } from "./prdSource";

export interface FetchPrdFromUrlResponse {
  title: string | null;
  content: string;
  sourceUrl: string;
}

/**
 * 通过 Tauri command 拉取 URL 正文内容。
 * 约定后端 command: fetch_prd_from_url
 */
export async function fetchPrdFromUrl(url: string): Promise<FetchPrdFromUrlResponse> {
  validatePrdUrl(url);
  return invoke<FetchPrdFromUrlResponse>("fetch_prd_from_url", { url: url.trim() });
}
