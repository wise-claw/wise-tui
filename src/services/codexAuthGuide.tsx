import { Input, Modal, Typography, message } from "antd";
import { getCodexAuthStatus, loginCodexWithApiKey } from "./codex";

let activeGuide: Promise<void> | null = null;

/**
 * 执行前认证门禁：登录成功后原请求继续，取消则终止本轮，避免把无凭据请求发到 OpenAI。
 */
export async function promptCodexApiKeyLogin(): Promise<void> {
  if (activeGuide) return activeGuide;

  activeGuide = new Promise<void>((resolve, reject) => {
    let apiKey = "";
    Modal.confirm({
      title: "连接 Codex",
      width: 460,
      okText: "使用 API Key",
      cancelText: "暂不连接",
      content: (
        <div style={{ marginTop: 8 }}>
          <Typography.Paragraph>
            当前 Codex 环境已禁用 ChatGPT 登录。请输入 OpenAI Platform API Key，Wise 会通过官方 Codex CLI 保存并连接。
          </Typography.Paragraph>
          <Input.Password
            autoFocus
            placeholder="sk-..."
            onChange={(event) => {
              apiKey = event.target.value;
            }}
            onPressEnter={() => undefined}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
            API Key 会通过 stdin 传给 `codex login --with-api-key`，不会放进命令行参数。
          </Typography.Paragraph>
        </div>
      ),
      onOk: async () => {
        const trimmed = apiKey.trim();
        if (!trimmed) {
          message.warning("请输入 OpenAI Platform API Key");
          throw new Error("请输入 OpenAI Platform API Key");
        }
        try {
          const next = await loginCodexWithApiKey(trimmed);
          if (!next.ready) throw new Error(next.detail || "Codex 登录状态仍不可用");
          message.success("Codex 已连接，正在继续执行");
          resolve();
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          message.error(text);
          reject(error);
          throw error;
        }
      },
      onCancel: () => reject(new Error("Codex 尚未认证，已取消本轮执行")),
    });
  }).finally(() => {
    activeGuide = null;
  });
  return activeGuide;
}

export async function ensureCodexAuthenticated(): Promise<void> {
  const status = await getCodexAuthStatus();
  if (status.ready) return;
  return promptCodexApiKeyLogin();
}
