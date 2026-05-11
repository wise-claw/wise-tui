import { App, Button, Dropdown, Spin, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  computerUseMcpLikelyRegistered,
  getCuaDriverStatus,
  installCuaDriver,
  macosOpenPrivacyPane,
  registerCuaDriverComputerUseMcp,
  updateCuaDriver,
  type CuaDriverStatus,
} from "../../services/cuaDriver";
import { getClaudeMcpStatus } from "../../services/claude";
import "./index.css";

interface Props {
  repositoryPath?: string | null;
  /** 为 false 时不拉取 cua-driver 状态（例如父级未展示）。 */
  active?: boolean;
  /** 安装或注册成功后调用，用于刷新 MCP 列表。 */
  onRefreshMcpList: () => void | Promise<void>;
}

export function ComputerUseMcpSection({ repositoryPath, active = true, onRefreshMcpList }: Props) {
  const { message, modal } = App.useApp();
  const [cuaDriverBusy, setCuaDriverBusy] = useState(false);
  const [cuaDriverStatusLoading, setCuaDriverStatusLoading] = useState(false);
  const [cuaDriverStatus, setCuaDriverStatus] = useState<CuaDriverStatus | null>(null);

  const refreshCuaDriverStatus = useCallback(async () => {
    setCuaDriverStatusLoading(true);
    try {
      setCuaDriverStatus(await getCuaDriverStatus());
    } finally {
      setCuaDriverStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refreshCuaDriverStatus();
  }, [active, refreshCuaDriverStatus]);

  const handleComputerUseOneClick = useCallback(async () => {
    setCuaDriverBusy(true);
    try {
      let status = await getCuaDriverStatus();
      setCuaDriverStatus(status);
      if (!status.platformMacos) {
        message.error("仅 macOS 支持该方案（cua-driver 使用系统私有接口实现后台注入）。");
        return;
      }
      let installLog: string | undefined;
      if (!status.installed) {
        installLog = await installCuaDriver();
        status = await getCuaDriverStatus();
        setCuaDriverStatus(status);
      }
      const exe = status.resolvedPath?.trim();
      if (!exe) {
        modal.error({
          title: "仍未找到 cua-driver",
          width: 520,
          content: (
            <pre className="app-mcp-computer-use-install-log">
              {(installLog ?? "无安装日志").slice(-6000)}
            </pre>
          ),
        });
        return;
      }
      const mcpLatest = await getClaudeMcpStatus(repositoryPath ?? null);
      const alreadyMcp = computerUseMcpLikelyRegistered(mcpLatest);
      if (!alreadyMcp) {
        try {
          await registerCuaDriverComputerUseMcp(exe);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/exist|已存在|duplicate|already|相同/i.test(msg)) {
            message.info("MCP 条目可能已存在，已跳过注册。");
          } else {
            throw e;
          }
        }
      }
      await onRefreshMcpList();
      message.success(
        alreadyMcp && status.installed
          ? "驱动与 MCP 已就绪（无需重复注册）"
          : "已安装/注册 cua-driver MCP；请在系统设置中授予辅助功能与屏幕录制",
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCuaDriverBusy(false);
    }
  }, [message, modal, repositoryPath, onRefreshMcpList]);

  const runUpdateCuaDriver = useCallback(async () => {
    setCuaDriverBusy(true);
    let installLog = "";
    try {
      installLog = await updateCuaDriver();
      const next = await getCuaDriverStatus();
      setCuaDriverStatus(next);
      await onRefreshMcpList();
      const ver = next.versionLine?.trim() || "已刷新";
      message.success(`cua-driver 已更新：${ver}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      modal.error({
        title: "更新失败",
        width: 520,
        content: (
          <pre className="app-mcp-computer-use-install-log">
            {(installLog ? `${err}\n\n--- 安装输出 ---\n${installLog}` : err).slice(-8000)}
          </pre>
        ),
      });
    } finally {
      setCuaDriverBusy(false);
    }
  }, [message, modal, onRefreshMcpList]);

  const handleUpdateCuaDriver = useCallback(() => {
    if (cuaDriverStatus?.platformMacos !== true || !cuaDriverStatus.installed) return;
    modal.confirm({
      title: "更新 cua-driver？",
      content:
        "将重新下载并执行官方 install.sh（与首次安装相同），需要稳定网络；完成后会刷新此处版本与 MCP 列表。是否继续？",
      okText: "更新",
      cancelText: "取消",
      onOk: () => runUpdateCuaDriver(),
    });
  }, [cuaDriverStatus?.installed, cuaDriverStatus?.platformMacos, modal, runUpdateCuaDriver]);

  if (!active) return null;

  const commandPreview =
    cuaDriverStatus?.resolvedPath?.trim() != null && cuaDriverStatus.resolvedPath.trim().length > 0
      ? `${cuaDriverStatus.resolvedPath.trim()} mcp --claude-code-computer-use-compat`
      : "安装后注册为 stdio：cua-driver · mcp --claude-code-computer-use-compat";

  return (
    <article className="app-mcp-hub-card app-mcp-computer-use-card app-computer-use-mcp-section">
      <div className="app-mcp-hub-card-top">
        <span className="app-mcp-hub-card-avatar" aria-hidden>
          C
        </span>
        <div className="app-mcp-hub-card-headline">
          <div className="app-mcp-hub-card-name-row">
            <span className="app-mcp-hub-card-name">Computer Use</span>
            {cuaDriverStatusLoading && !cuaDriverStatus ? (
              <Spin size="small" />
            ) : cuaDriverStatus ? (
              <>
                {cuaDriverStatus.platformMacos ? (
                  <Tag color={cuaDriverStatus.installed ? "success" : "default"} className="app-mcp-hub-card-tag">
                    {cuaDriverStatus.installed
                      ? cuaDriverStatus.versionLine?.trim() || "cua-driver 已安装"
                      : "未检测到"}
                  </Tag>
                ) : (
                  <Tag className="app-mcp-hub-card-tag">非 macOS</Tag>
                )}
              </>
            ) : (
              <Tag className="app-mcp-hub-card-tag">状态未知</Tag>
            )}
          </div>
          <div className="app-mcp-hub-card-scope">
            {cuaDriverStatus?.platformMacos
              ? "cua-driver stdio MCP"
              : (cuaDriverStatus?.hint ?? "检查运行环境中…")}
          </div>
        </div>
      </div>
      <div className="app-mcp-hub-card-command" title={commandPreview}>
        {commandPreview}
      </div>
      <div className="app-mcp-hub-card-tools">
        <span className="app-mcp-hub-tool-chip">stdio</span>
        <span className="app-mcp-hub-tool-chip">computer-use</span>
      </div>
      <div className="app-mcp-hub-card-actions app-mcp-computer-use-card-actions">
        {cuaDriverStatus?.platformMacos ? (
          <Dropdown
            menu={{
              items: [
                {
                  key: "ax",
                  label: "辅助功能",
                  onClick: () =>
                    void macosOpenPrivacyPane("accessibility").catch((e) =>
                      message.warning(e instanceof Error ? e.message : String(e)),
                    ),
                },
                {
                  key: "scr",
                  label: "屏幕录制",
                  onClick: () =>
                    void macosOpenPrivacyPane("screenCapture").catch((e) =>
                      message.warning(e instanceof Error ? e.message : String(e)),
                    ),
                },
              ],
            }}
          >
            <Button type="link" size="small" className="app-mcp-computer-use-link-btn">
              系统权限
            </Button>
          </Dropdown>
        ) : null}
        {cuaDriverStatus?.platformMacos && cuaDriverStatus.installed ? (
          <Button
            type="default"
            size="small"
            loading={cuaDriverBusy}
            onClick={() => handleUpdateCuaDriver()}
          >
            更新
          </Button>
        ) : null}
        <Button
          type="primary"
          size="small"
          loading={cuaDriverBusy}
          disabled={cuaDriverStatus?.platformMacos !== true}
          onClick={() => void handleComputerUseOneClick()}
        >
          安装
        </Button>
      </div>
    </article>
  );
}
