import { invoke } from "@tauri-apps/api/core";
import { DINGTALK_ENTERPRISE_BOT_APP_SETTINGS_KEY } from "../constants/dingtalkEnterpriseBot";
import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

export interface DingTalkEnterpriseBotStoredConfig {
  appKey: string;
  appSecret: string;
  robotCode: string;
  /** 可选：测试发送时的默认接收人 userId */
  defaultUserId?: string;
}

export async function loadDingTalkEnterpriseBotConfig(): Promise<DingTalkEnterpriseBotStoredConfig | null> {
  return getAppSettingJson<DingTalkEnterpriseBotStoredConfig>(DINGTALK_ENTERPRISE_BOT_APP_SETTINGS_KEY);
}

export async function saveDingTalkEnterpriseBotConfig(config: DingTalkEnterpriseBotStoredConfig): Promise<void> {
  await setAppSettingJson(DINGTALK_ENTERPRISE_BOT_APP_SETTINGS_KEY, config);
}

export interface DingTalkOtoBatchSendResult {
  processQueryKey?: string | null;
  invalidStaffIdList?: string[] | null;
  flowControlledStaffIdList?: string[] | null;
}

/**
 * 调用钉钉「批量发送人与机器人会话中机器人消息」（Markdown）。
 * 需在企业内开通「企业内机器人发送消息」等权限，并创建企业内部应用机器人。
 */
export async function dingtalkEnterpriseBotOtoSendMarkdown(params: {
  appKey: string;
  appSecret: string;
  robotCode: string;
  userIds: string[];
  title: string;
  text: string;
}): Promise<DingTalkOtoBatchSendResult> {
  return invoke<DingTalkOtoBatchSendResult>("dingtalk_enterprise_bot_oto_send_markdown", {
    appKey: params.appKey.trim(),
    appSecret: params.appSecret.trim(),
    robotCode: params.robotCode.trim(),
    userIds: params.userIds.map((u) => u.trim()).filter(Boolean),
    title: params.title.trim(),
    text: params.text.trim(),
  });
}

/** 公网 HTTPS 图片 URL，对应钉钉模板 `sampleImageMsg`。 */
export async function dingtalkEnterpriseBotOtoSendImageByUrl(params: {
  appKey: string;
  appSecret: string;
  robotCode: string;
  userIds: string[];
  photoUrl: string;
}): Promise<DingTalkOtoBatchSendResult> {
  return invoke<DingTalkOtoBatchSendResult>("dingtalk_enterprise_bot_oto_send_image_by_url", {
    appKey: params.appKey.trim(),
    appSecret: params.appSecret.trim(),
    robotCode: params.robotCode.trim(),
    userIds: params.userIds.map((u) => u.trim()).filter(Boolean),
    photoUrl: params.photoUrl.trim(),
  });
}

/** 本机绝对路径图片文件（≤1MB），经 `media/upload` 后发单聊图。 */
export async function dingtalkEnterpriseBotOtoSendImageFile(params: {
  appKey: string;
  appSecret: string;
  robotCode: string;
  userIds: string[];
  localFilePath: string;
}): Promise<DingTalkOtoBatchSendResult> {
  return invoke<DingTalkOtoBatchSendResult>("dingtalk_enterprise_bot_oto_send_image_file", {
    appKey: params.appKey.trim(),
    appSecret: params.appSecret.trim(),
    robotCode: params.robotCode.trim(),
    userIds: params.userIds.map((u) => u.trim()).filter(Boolean),
    localFilePath: params.localFilePath.trim(),
  });
}

/** 仅校验 appKey/appSecret 能否换取 access_token。 */
export async function dingtalkEnterpriseBotPing(appKey: string, appSecret: string): Promise<void> {
  await invoke("dingtalk_enterprise_bot_ping", {
    appKey: appKey.trim(),
    appSecret: appSecret.trim(),
  });
}
