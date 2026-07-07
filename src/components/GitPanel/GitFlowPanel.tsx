import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApartmentOutlined,
  BranchesOutlined,
  BugOutlined,
  NodeIndexOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, message, Modal } from "antd";
import type { MenuProps } from "antd";
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

interface GitFlowPanelProps {
  repositoryPath: string;
  onFlowOperationDone?: () => void;
}

type FlowAction = "feature" | "release" | "hotfix";

export function GitFlowPanel({ repositoryPath, onFlowOperationDone }: GitFlowPanelProps) {
  const [flowInfo, setFlowInfo] = useState<GitFlowInfo | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [flowDropdownOpen, setFlowDropdownOpen] = useState(false);
  const [modalState, setModalState] = useState<{
    open: boolean;
    action: FlowAction;
    subAction: "start" | "finish";
    name: string;
  } | null>(null);

  // 缓存加载中的 flowInfo 查询，避免重复请求
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const loadFlowInfo = useCallback(async () => {
    if (!repositoryPath) return;
    if (loadPromiseRef.current) return loadPromiseRef.current;
    setFlowLoading(true);
    const promise = (async () => {
      try {
        const info = await gitFlowInfo(repositoryPath);
        setFlowInfo(info);
      } catch {
        setFlowInfo(null);
      } finally {
        setFlowLoading(false);
        loadPromiseRef.current = null;
      }
    })();
    loadPromiseRef.current = promise;
    return promise;
  }, [repositoryPath]);

  useEffect(() => {
    if (flowDropdownOpen) {
      void loadFlowInfo();
    }
  }, [flowDropdownOpen, loadFlowInfo]);

  const handleInit = useCallback(async () => {
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

  const openModal = useCallback((action: FlowAction, subAction: "start" | "finish") => {
    setModalState({ open: true, action, subAction, name: "" });
  }, []);

  const closeModal = useCallback(() => {
    setModalState(null);
  }, []);

  const handleModalConfirm = useCallback(async () => {
    if (!modalState) return;
    const { action, subAction, name } = modalState;
    const nameTrimmed = name.trim();
    if (subAction === "start" && !nameTrimmed) {
      message.error("请输入名称");
      return;
    }

    const loadingKey = `${action}_${subAction}`;
    setActionLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      switch (action) {
        case "feature": {
          if (subAction === "start") {
            await gitFlowFeatureStart(repositoryPath, nameTrimmed);
            message.success(`Feature 分支 feature/${nameTrimmed} 已创建`);
          } else {
            await gitFlowFeatureFinish(repositoryPath, nameTrimmed);
            message.success(`Feature feature/${nameTrimmed} 已完成`);
          }
          break;
        }
        case "release": {
          if (subAction === "start") {
            await gitFlowReleaseStart(repositoryPath, nameTrimmed);
            message.success(`Release 分支 release/${nameTrimmed} 已创建`);
          } else {
            await gitFlowReleaseFinish(repositoryPath, nameTrimmed);
            message.success(`Release ${nameTrimmed} 已完成`);
          }
          break;
        }
        case "hotfix": {
          if (subAction === "start") {
            await gitFlowHotfixStart(repositoryPath, nameTrimmed);
            message.success(`Hotfix 分支 hotfix/${nameTrimmed} 已创建`);
          } else {
            await gitFlowHotfixFinish(repositoryPath, nameTrimmed);
            message.success(`Hotfix ${nameTrimmed} 已完成`);
          }
          break;
        }
      }
      closeModal();
      onFlowOperationDone?.();
    } catch (e) {
      message.error(`操作失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  }, [modalState, closeModal, onFlowOperationDone, repositoryPath]);

  const dropdownItems = useMemo((): MenuProps["items"] => {
    const items: MenuProps["items"] = [];
    const info = flowInfo;
    const loading = actionLoading;

    if (!info) {
      items.push({
        key: "loading",
        label: flowLoading ? "加载中..." : "无法获取 Git Flow 信息",
        disabled: true,
      });
      return items;
    }

    if (!info.hasDevelop) {
      items.push({
        key: "init",
        label: "初始化 Git Flow",
        icon: <NodeIndexOutlined />,
        onClick: () => void handleInit(),
        disabled: loading.init,
      });
      items.push({ type: "divider" });
    }

    items.push({
      key: "status",
      label: (
        <span className="git-flow-menu-status">
          <span className="git-flow-menu-status__main">{info.mainBranch}</span>
          {info.hasDevelop ? (
            <span className="git-flow-menu-status__dev">develop</span>
          ) : null}
          {info.currentBranch ? (
            <span className="git-flow-menu-status__cur">{info.currentBranch}</span>
          ) : null}
        </span>
      ),
      disabled: true,
    });
    items.push({ type: "divider" });

    // Feature
    items.push({
      key: "feature_start",
      label: "开始 Feature",
      icon: <BranchesOutlined />,
      onClick: () => openModal("feature", "start"),
      disabled: !info.hasDevelop || loading.feature_start,
    });
    items.push({
      key: "feature_finish",
      label: "完成 Feature",
      icon: <BranchesOutlined />,
      onClick: () => openModal("feature", "finish"),
      disabled: !info.hasDevelop || loading.feature_finish,
    });
    items.push({ type: "divider" });

    // Release
    items.push({
      key: "release_start",
      label: "开始 Release",
      icon: <RocketOutlined />,
      onClick: () => openModal("release", "start"),
      disabled: !info.hasDevelop || loading.release_start,
    });
    items.push({
      key: "release_finish",
      label: "完成 Release",
      icon: <RocketOutlined />,
      onClick: () => openModal("release", "finish"),
      disabled: !info.hasDevelop || loading.release_finish,
    });
    items.push({ type: "divider" });

    // Hotfix
    items.push({
      key: "hotfix_start",
      label: "开始 Hotfix",
      icon: <BugOutlined />,
      onClick: () => openModal("hotfix", "start"),
      disabled: loading.hotfix_start,
    });
    items.push({
      key: "hotfix_finish",
      label: "完成 Hotfix",
      icon: <BugOutlined />,
      onClick: () => openModal("hotfix", "finish"),
      disabled: loading.hotfix_finish,
    });

    return items;
  }, [flowInfo, flowLoading, actionLoading, handleInit, openModal]);

  const modalTitle = useMemo(() => {
    if (!modalState) return "";
    const { action, subAction } = modalState;
    const actionLabel = action === "feature" ? "Feature" : action === "release" ? "Release" : "Hotfix";
    const subLabel = subAction === "start" ? "开始" : "完成";
    return `${subLabel} ${actionLabel}`;
  }, [modalState]);

  const modalPlaceholder = useMemo(() => {
    if (!modalState) return "";
    const { action, subAction } = modalState;
    if (subAction === "finish") return "请输入名称（不含前缀）";
    if (action === "feature") return "输入 feature 名称（如 my-feature）";
    if (action === "release") return "输入版本号（如 1.2.0）";
    return "输入版本号（如 1.2.1）";
  }, [modalState]);

  const isFinish = modalState?.subAction === "finish";

  return (
    <>
      <Dropdown
        menu={{
          items: dropdownItems,
          className: "git-flow-dropdown-menu",
          style: { minWidth: 220 },
        }}
        trigger={["click"]}
        open={flowDropdownOpen}
        onOpenChange={(open) => {
          setFlowDropdownOpen(open);
          if (!open) {
            setFlowInfo(null);
          }
        }}
      >
        <Button
          type="text"
          size="small"
          title="Git Flow 操作"
          className={`git-flow-trigger-btn${flowDropdownOpen ? " git-flow-trigger-btn--active" : ""}`}
          icon={<ApartmentOutlined />}
          aria-label="Git Flow 操作"
          aria-haspopup="menu"
        />
      </Dropdown>

      <Modal
        open={modalState?.open ?? false}
        title={modalTitle}
        onOk={() => void handleModalConfirm()}
        onCancel={closeModal}
        okText={isFinish ? "完成" : "开始"}
        cancelText="取消"
        destroyOnHidden
        width={380}
        centered
      >
        {isFinish ? (
          <div style={{ fontSize: 12, color: "var(--ant-color-warning)", marginBottom: 8 }}>
            将合并 <code>{modalState?.action}/{modalState?.name}</code> 到主分支并删除原分支
          </div>
        ) : null}
        <Input
          size="small"
          placeholder={modalPlaceholder}
          value={modalState?.name ?? ""}
          onChange={(e) =>
            setModalState((prev) => (prev ? { ...prev, name: e.target.value } : null))
          }
          onPressEnter={() => void handleModalConfirm()}
          autoFocus
        />
      </Modal>
    </>
  );
}
