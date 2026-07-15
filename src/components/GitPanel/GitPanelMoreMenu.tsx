import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, message, Modal } from "antd";
import type { MenuProps } from "antd";
import {
  ApartmentOutlined,
  BranchesOutlined,
  BugOutlined,
  GlobalOutlined,
  HistoryOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import {
  gitFlowFeatureFinish,
  gitFlowFeatureStart,
  gitFlowHotfixFinish,
  gitFlowHotfixStart,
  gitFlowInfo,
  gitFlowInit,
  gitFlowReleaseFinish,
  gitFlowReleaseStart,
} from "../../services/git";
import type { GitFlowInfo } from "../../types";

/** 更多菜单项标识 */
export type MoreMenuItemId = "history" | "browser" | "git-flow";

/** 默认全部提到工具栏，不再收进「更多」 */
const DEFAULT_INLINE_KEYS: ReadonlySet<MoreMenuItemId> = new Set([
  "history",
  "browser",
  "git-flow",
]);

interface GitPanelMoreMenuProps {
  /** 仓库路径，传入则启用 Git Flow 功能 */
  repositoryPath?: string;
  /** 展示在外部（header 按钮）的项；默认全部外放 */
  showInlineKeys?: ReadonlySet<MoreMenuItemId>;
  historyActive?: boolean;
  onOpenHistory?: () => void;
  onOpenInBrowser?: () => void;
  openingBrowser?: boolean;
  onFlowOperationDone?: () => void;
}

type FlowAction = "feature" | "release" | "hotfix";

export function GitPanelMoreMenu({
  repositoryPath,
  showInlineKeys = DEFAULT_INLINE_KEYS,
  historyActive = false,
  onOpenHistory,
  onOpenInBrowser,
  openingBrowser = false,
  onFlowOperationDone,
}: GitPanelMoreMenuProps) {
  // — Git Flow state —
  const [flowInfo, setFlowInfo] = useState<GitFlowInfo | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [flowModal, setFlowModal] = useState<{
    open: boolean;
    action: FlowAction;
    subAction: "start" | "finish";
    name: string;
  } | null>(null);

  const loadFlowPromiseRef = useRef<Promise<void> | null>(null);
  const inlineKeys = showInlineKeys;

  const loadFlowInfo = useCallback(async () => {
    if (!repositoryPath) return;
    if (loadFlowPromiseRef.current) return loadFlowPromiseRef.current;
    setFlowLoading(true);
    const p = (async () => {
      try {
        setFlowInfo(await gitFlowInfo(repositoryPath));
      } catch {
        setFlowInfo(null);
      } finally {
        setFlowLoading(false);
        loadFlowPromiseRef.current = null;
      }
    })();
    loadFlowPromiseRef.current = p;
    return p;
  }, [repositoryPath]);

  useEffect(() => {
    void loadFlowInfo();
  }, [loadFlowInfo]);

  const handleFlowInit = useCallback(async () => {
    if (!repositoryPath) return;
    setActionLoading((prev) => ({ ...prev, init: true }));
    try {
      await gitFlowInit(repositoryPath);
      message.success("Git Flow 初始化完成");
      await loadFlowInfo();
      onFlowOperationDone?.();
    } catch (e) {
      message.error(`Git Flow 初始化失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionLoading((prev) => ({ ...prev, init: false }));
    }
  }, [loadFlowInfo, onFlowOperationDone, repositoryPath]);

  const openFlowModal = useCallback((action: FlowAction, subAction: "start" | "finish") => {
    setFlowModal({ open: true, action, subAction, name: "" });
  }, []);

  const closeFlowModal = useCallback(() => {
    setFlowModal(null);
  }, []);

  const handleFlowModalConfirm = useCallback(async () => {
    if (!flowModal || !repositoryPath) return;
    const { action, subAction, name } = flowModal;
    const t = name.trim();
    if (subAction === "start" && !t) { message.error("请输入名称"); return; }
    const k = `${action}_${subAction}`;
    setActionLoading((prev) => ({ ...prev, [k]: true }));
    try {
      switch (action) {
        case "feature":
          if (subAction === "start") { await gitFlowFeatureStart(repositoryPath, t); message.success(`Feature 分支 feature/${t} 已创建`); }
          else { await gitFlowFeatureFinish(repositoryPath, t); message.success(`Feature feature/${t} 已完成`); }
          break;
        case "release":
          if (subAction === "start") { await gitFlowReleaseStart(repositoryPath, t); message.success(`Release 分支 release/${t} 已创建`); }
          else { await gitFlowReleaseFinish(repositoryPath, t); message.success(`Release ${t} 已完成`); }
          break;
        case "hotfix":
          if (subAction === "start") { await gitFlowHotfixStart(repositoryPath, t); message.success(`Hotfix 分支 hotfix/${t} 已创建`); }
          else { await gitFlowHotfixFinish(repositoryPath, t); message.success(`Hotfix ${t} 已完成`); }
          break;
      }
      closeFlowModal();
      onFlowOperationDone?.();
    } catch (e) {
      message.error(`操作失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionLoading((prev) => ({ ...prev, [k]: false }));
    }
  }, [flowModal, closeFlowModal, onFlowOperationDone, repositoryPath]);

  const flowSubmenuItems = useMemo(
    () =>
      repositoryPath
        ? buildFlowSubmenuItems(flowInfo, flowLoading, actionLoading, handleFlowInit, openFlowModal)
        : [],
    [repositoryPath, flowInfo, flowLoading, actionLoading, handleFlowInit, openFlowModal],
  );

  // — 「更多」里只保留尚未外放的项 —
  const menuItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];

    if (onOpenHistory && !inlineKeys.has("history")) {
      items.push({
        key: "history",
        label: "提交历史",
        icon: <HistoryOutlined />,
        className: historyActive ? "git-panel-more-menu__item--active" : undefined,
        onClick: onOpenHistory,
      });
    }
    if (onOpenInBrowser && !inlineKeys.has("browser")) {
      items.push({
        key: "browser",
        label: "在浏览器中打开仓库",
        icon: <GlobalOutlined />,
        disabled: openingBrowser,
        onClick: onOpenInBrowser,
      });
    }

    if (repositoryPath && !inlineKeys.has("git-flow") && (flowSubmenuItems?.length ?? 0) > 0) {
      if (items.length > 0) {
        items.push({ type: "divider" });
      }
      items.push({
        key: "git-flow",
        label: "Git Flow",
        icon: <ApartmentOutlined />,
        popupClassName: "git-flow-dropdown-menu",
        children: flowSubmenuItems,
      });
    }

    return items;
  }, [
    onOpenHistory,
    historyActive,
    onOpenInBrowser,
    openingBrowser,
    repositoryPath,
    inlineKeys,
    flowSubmenuItems,
  ]);

  // — 外部 inline 按钮 —
  const inlineItems = useMemo(() => {
    const btns: { key: MoreMenuItemId; el: ReactNode }[] = [];
    if (inlineKeys.has("history") && onOpenHistory) {
      btns.push({
        key: "history",
        el: (
          <Button
            key="inline-history"
            type="text"
            size="small"
            title="提交历史"
            aria-label="提交历史"
            className={`git-panel-more-btn${historyActive ? " git-panel-more-btn--active" : ""}`}
            icon={<HistoryOutlined />}
            onClick={onOpenHistory}
          />
        ),
      });
    }
    if (inlineKeys.has("browser") && onOpenInBrowser) {
      btns.push({
        key: "browser",
        el: (
          <Button
            key="inline-browser"
            type="text"
            size="small"
            title="在浏览器中打开仓库"
            aria-label="在浏览器中打开仓库"
            className="git-panel-more-btn"
            icon={<GlobalOutlined />}
            loading={openingBrowser}
            disabled={openingBrowser}
            onClick={onOpenInBrowser}
          />
        ),
      });
    }
    if (inlineKeys.has("git-flow") && repositoryPath && (flowSubmenuItems?.length ?? 0) > 0) {
      btns.push({
        key: "git-flow",
        el: (
          <Dropdown
            key="inline-git-flow"
            menu={{ items: flowSubmenuItems, className: "git-flow-dropdown-menu" }}
            classNames={{ root: "git-panel-more-menu-dropdown" }}
            trigger={["click"]}
          >
            <Button
              type="text"
              size="small"
              title="Git Flow"
              aria-label="Git Flow"
              className="git-panel-more-btn git-flow-trigger-btn"
              icon={<ApartmentOutlined />}
              aria-haspopup="menu"
            />
          </Dropdown>
        ),
      });
    }
    return btns;
  }, [
    inlineKeys,
    historyActive,
    onOpenHistory,
    onOpenInBrowser,
    openingBrowser,
    repositoryPath,
    flowSubmenuItems,
  ]);

  const showDropdown = (menuItems?.length ?? 0) > 0;

  // — Flow Modal 统一放在组件层级 —
  const flowModalTitle = useMemo(() => {
    if (!flowModal) return "";
    const al = flowModal.action === "feature" ? "Feature" : flowModal.action === "release" ? "Release" : "Hotfix";
    return `${flowModal.subAction === "start" ? "开始" : "完成"} ${al}`;
  }, [flowModal]);
  const flowModalPlaceholder = useMemo(() => {
    if (!flowModal) return "";
    if (flowModal.subAction === "finish") return "请输入名称（不含前缀）";
    if (flowModal.action === "feature") return "输入 feature 名称（如 my-feature）";
    if (flowModal.action === "release") return "输入版本号（如 1.2.0）";
    return "输入版本号（如 1.2.1）";
  }, [flowModal]);
  const isFinish = flowModal?.subAction === "finish";

  return (
    <>
      {inlineItems.map((item) => item.el)}
      {showDropdown ? (
        <Dropdown
          menu={{ items: menuItems, className: "git-panel-more-menu" }}
          classNames={{ root: "git-panel-more-menu-dropdown" }}
          trigger={["click"]}
        >
          <Button
            type="text"
            size="small"
            className="git-panel-more-btn"
            icon={<MoreOutlined />}
            aria-label="更多 Git 操作"
            aria-haspopup="menu"
          />
        </Dropdown>
      ) : null}

      <Modal
        open={flowModal?.open ?? false}
        title={flowModalTitle}
        onOk={() => void handleFlowModalConfirm()}
        onCancel={closeFlowModal}
        okText={isFinish ? "完成" : "开始"}
        cancelText="取消"
        destroyOnHidden
        width={380}
        centered
      >
        {isFinish ? (
          <div style={{ fontSize: 12, color: "var(--ant-color-warning)", marginBottom: 8 }}>
            将合并 <code>{flowModal?.action}/{flowModal?.name}</code> 到主分支并删除原分支
          </div>
        ) : null}
        <Input
          size="small"
          placeholder={flowModalPlaceholder}
          value={flowModal?.name ?? ""}
          onChange={(e) =>
            setFlowModal((prev) => (prev ? { ...prev, name: e.target.value } : null))
          }
          onPressEnter={() => void handleFlowModalConfirm()}
          autoFocus
        />
      </Modal>
    </>
  );
}

/** 构建 Git Flow 子菜单项 */
function buildFlowSubmenuItems(
  flowInfo: GitFlowInfo | null,
  flowLoading: boolean,
  actionLoading: Record<string, boolean>,
  onInit: () => void,
  onOpenModal: (action: FlowAction, subAction: "start" | "finish") => void,
): MenuProps["items"] {
  const items: MenuProps["items"] = [];

  if (!flowInfo) {
    items.push({
      key: "flow-loading",
      label: flowLoading ? "加载中..." : "无法获取信息",
      disabled: true,
    });
    return items;
  }

  if (!flowInfo.hasDevelop) {
    items.push({
      key: "flow-init",
      label: "初始化",
      icon: <NodeIndexOutlined />,
      onClick: onInit,
      disabled: actionLoading.init,
    });
    items.push({ type: "divider" });
  }

  items.push({
    key: "flow-status",
    label: (
      <span className="git-flow-menu-status">
        <span className="git-flow-menu-status__main">{flowInfo.mainBranch}</span>
        {flowInfo.hasDevelop ? <span className="git-flow-menu-status__dev">develop</span> : null}
        {flowInfo.currentBranch ? <span className="git-flow-menu-status__cur">{flowInfo.currentBranch}</span> : null}
      </span>
    ),
    disabled: true,
  });
  items.push({ type: "divider" });

  items.push({ key: "feature_start", label: "开始 Feature", icon: <BranchesOutlined />, onClick: () => onOpenModal("feature", "start"), disabled: !flowInfo.hasDevelop || !!actionLoading.feature_start });
  items.push({ key: "feature_finish", label: "完成 Feature", icon: <BranchesOutlined />, onClick: () => onOpenModal("feature", "finish"), disabled: !flowInfo.hasDevelop || !!actionLoading.feature_finish });
  items.push({ type: "divider" });
  items.push({ key: "release_start", label: "开始 Release", icon: <RocketOutlined />, onClick: () => onOpenModal("release", "start"), disabled: !flowInfo.hasDevelop || !!actionLoading.release_start });
  items.push({ key: "release_finish", label: "完成 Release", icon: <RocketOutlined />, onClick: () => onOpenModal("release", "finish"), disabled: !flowInfo.hasDevelop || !!actionLoading.release_finish });
  items.push({ type: "divider" });
  items.push({ key: "hotfix_start", label: "开始 Hotfix", icon: <BugOutlined />, onClick: () => onOpenModal("hotfix", "start"), disabled: !!actionLoading.hotfix_start });
  items.push({ key: "hotfix_finish", label: "完成 Hotfix", icon: <BugOutlined />, onClick: () => onOpenModal("hotfix", "finish"), disabled: !!actionLoading.hotfix_finish });

  return items;
}
