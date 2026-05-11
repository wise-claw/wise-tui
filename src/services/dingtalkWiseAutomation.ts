import type { WiseDingTalkAutomationV1Payload } from "../constants/dingtalkWiseAutomation";
import {
  dingtalkEnterpriseBotOtoSendImageByUrl,
  dingtalkEnterpriseBotOtoSendImageFile,
  dingtalkEnterpriseBotOtoSendMarkdown,
  loadDingTalkEnterpriseBotConfig,
} from "./dingtalkEnterpriseBot";

const MAX_MARKDOWN_CHARS = 3800;

function isNonEmptyStringArray(a: unknown): a is string[] {
  if (!Array.isArray(a) || a.length === 0) return false;
  return a.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function isWiseDingTalkAutomationV1Payload(x: unknown): x is WiseDingTalkAutomationV1Payload {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.dingTalkUserId !== "string" || !o.dingTalkUserId.trim()) return false;
  const promptStr = typeof o.prompt === "string" ? o.prompt : "";
  const promptOk = promptStr.trim().length > 0;
  const imagesOk = o.imageDataUrls !== undefined && o.imageDataUrls !== null && isNonEmptyStringArray(o.imageDataUrls);
  if (!promptOk && !imagesOk) return false;
  if (o.repositoryName !== undefined && o.repositoryName !== null && typeof o.repositoryName !== "string") {
    return false;
  }
  if (o.imageDataUrls !== undefined && o.imageDataUrls !== null && !isNonEmptyStringArray(o.imageDataUrls)) {
    return false;
  }
  return true;
}

/**
 * 将 Claude 处理结果以「人与机器人单聊」Markdown 发回钉钉（使用侧栏已保存的企业机器人凭证）。
 */
export async function sendDingTalkWiseAutomationReplyMarkdown(
  dingTalkUserId: string,
  markdownBody: string,
  /** 钉钉卡片标题；正文仅使用 markdownBody，避免标题与正文重复堆信息 */
  title = "回复",
): Promise<void> {
  const uid = dingTalkUserId.trim();
  if (!uid) return;
  const cfg = await loadDingTalkEnterpriseBotConfig();
  if (!cfg?.appKey?.trim() || !cfg.appSecret?.trim() || !cfg.robotCode?.trim()) {
    throw new Error("钉钉机器人未配置完整（AppKey / AppSecret / robotCode）");
  }
  let text = markdownBody.trim() || " ";
  if (text.length > MAX_MARKDOWN_CHARS) {
    text = `${text.slice(0, MAX_MARKDOWN_CHARS)}\n\n…（已截断）`;
  }
  await dingtalkEnterpriseBotOtoSendMarkdown({
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    robotCode: cfg.robotCode,
    userIds: [uid],
    title: title.trim() || "回复",
    text,
  });
}

/** 使用公网 HTTPS 图片地址向钉钉单聊发图（需机器人模板 `sampleImageMsg`）。 */
export async function sendDingTalkWiseAutomationReplyImageByUrl(dingTalkUserId: string, photoUrl: string): Promise<void> {
  const uid = dingTalkUserId.trim();
  const url = photoUrl.trim();
  if (!uid || !url) return;
  const cfg = await loadDingTalkEnterpriseBotConfig();
  if (!cfg?.appKey?.trim() || !cfg.appSecret?.trim() || !cfg.robotCode?.trim()) {
    throw new Error("钉钉机器人未配置完整（AppKey / AppSecret / robotCode）");
  }
  await dingtalkEnterpriseBotOtoSendImageByUrl({
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    robotCode: cfg.robotCode,
    userIds: [uid],
    photoUrl: url,
  });
}

/** 从本机绝对路径读图，经钉钉 `media/upload` 后单聊发图（单张 ≤1MB）。 */
export async function sendDingTalkWiseAutomationReplyImageFromFile(
  dingTalkUserId: string,
  absoluteFilePath: string,
): Promise<void> {
  const uid = dingTalkUserId.trim();
  const p = absoluteFilePath.trim();
  if (!uid || !p) return;
  const cfg = await loadDingTalkEnterpriseBotConfig();
  if (!cfg?.appKey?.trim() || !cfg.appSecret?.trim() || !cfg.robotCode?.trim()) {
    throw new Error("钉钉机器人未配置完整（AppKey / AppSecret / robotCode）");
  }
  await dingtalkEnterpriseBotOtoSendImageFile({
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    robotCode: cfg.robotCode,
    userIds: [uid],
    localFilePath: p,
  });
}
