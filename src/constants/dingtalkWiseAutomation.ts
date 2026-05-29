/** 主窗监听：与 `wise_mascot::emit_dingtalk_wise_automation_v1_if_applicable` 事件名一致 */
export const WISE_DINGTALK_AUTOMATION_V1_EVENT = "wise-dingtalk-automation-v1" as const;

/** 写入 `wise_notification_ingest` 的 JSON body 时用于识别自动化载荷 */
export const WISE_AUTOMATION_MARKER_DINGTALK_V1 = "dingtalk:v1" as const;

export interface WiseDingTalkAutomationV1Payload {
  dingTalkUserId: string;
  repositoryName?: string | null;
  /** 文本指令；可与 `imageDataUrls` 同时存在。可与图片二选一（自建网关时可仅传 `imageDataUrls`）。 */
  prompt?: string | null;
  /** 来自钉钉 Stream 网关拉取的图片（data URL），由主窗落盘为 `~/.wise/composer-images/…` 后发给 Claude。 */
  imageDataUrls?: string[] | null;
}
