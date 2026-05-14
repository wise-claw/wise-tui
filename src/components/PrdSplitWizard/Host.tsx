/**
 * 全局挂载点：浮动按钮 + 自定义事件监听 → 打开 PrdSplitWizardModal。
 *
 * 设计：
 * - 一个 FAB 按钮永久挂在右下角（z-index 高，但避开主交互区）。
 * - 监听 `window` 自定义事件 `wise:open-prd-split-wizard`，允许 AppImpl 等其他组件通过
 *   `window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD, { detail: { projectId } }))`
 *   触发打开（detail.projectId / repositoryId 可指定初始目标）。
 * - 项目 + 仓库列表通过 Tauri 现场拉取，不在父组件存储——避免与现有 App state 耦合。
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { ApartmentOutlined } from "@ant-design/icons";
import { loadRepositories } from "../../services/repository";
import { listProjects } from "../../services/projectState";
import { PrdSplitWizardModal } from "./PrdSplitWizardModal";
import type { ProjectItem, Repository } from "../../types";
import {
  WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD,
  type OpenPrdSplitWizardDetail,
} from "../../constants/workflowUiEvents";

export const OPEN_PRD_SPLIT_WIZARD_EVENT = WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD;
export type OpenPrdSplitWizardEventDetail = OpenPrdSplitWizardDetail;

export function PrdSplitWizardHost() {
  const [open, setOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [initialProjectId, setInitialProjectId] = useState<string | null>(null);
  const [initialRepositoryId, setInitialRepositoryId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listProjects(), loadRepositories()]);
      setProjects(p);
      setRepositories(r);
    } catch {
      // 静默：FAB 按钮在 list 失败时仍可被点击，wizard 内会显示空提示。
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<OpenPrdSplitWizardEventDetail>).detail;
      setInitialProjectId(detail?.projectId ?? null);
      setInitialRepositoryId(detail?.repositoryId ?? null);
      setModalKey((current) => current + 1);
      setOpen(true);
      void refresh();
    }
    window.addEventListener(OPEN_PRD_SPLIT_WIZARD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PRD_SPLIT_WIZARD_EVENT, onOpen);
  }, [refresh]);

  const onFabClick = useCallback(() => {
    setInitialProjectId(null);
    setInitialRepositoryId(null);
    setModalKey((current) => current + 1);
    setOpen(true);
    void refresh();
  }, [refresh]);

  return (
    <>
      <Tooltip title="需求拆分 (Trellis pipeline)" placement="left">
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<ApartmentOutlined />}
          onClick={onFabClick}
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 1500,
            boxShadow: "0 6px 18px rgba(22, 119, 255, 0.35)",
          }}
        />
      </Tooltip>
      <PrdSplitWizardModal
        key={modalKey}
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        repositories={repositories}
        initialProjectId={initialProjectId}
        initialRepositoryId={initialRepositoryId}
      />
    </>
  );
}
