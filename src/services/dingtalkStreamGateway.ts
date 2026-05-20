import { invoke } from "@tauri-apps/api/core";

/** 启动本机内嵌钉钉 Stream 网关（需已保存 AppKey / AppSecret）。 */
export async function dingtalkStreamGatewayStart(): Promise<void> {
  await invoke("dingtalk_stream_gateway_start");
}

export async function dingtalkStreamGatewayStop(): Promise<void> {
  await invoke("dingtalk_stream_gateway_stop");
}

export async function dingtalkStreamGatewayIsRunning(): Promise<boolean> {
  return invoke<boolean>("dingtalk_stream_gateway_is_running");
}

export interface DingTalkStreamGatewayStatus {
  running: boolean;
  phase: "stopped" | "connecting" | "connected" | "reconnecting" | string;
  startedAt?: string | null;
  connectedAt?: string | null;
  lastInboundAt?: string | null;
  lastErrorAt?: string | null;
  lastError?: string | null;
  lastStoppedAt?: string | null;
}

export async function dingtalkStreamGatewayStatus(): Promise<DingTalkStreamGatewayStatus> {
  return invoke<DingTalkStreamGatewayStatus>("dingtalk_stream_gateway_status");
}
