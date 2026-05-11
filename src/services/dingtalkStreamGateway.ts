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
