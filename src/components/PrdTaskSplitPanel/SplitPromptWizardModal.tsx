import { Button, Modal, Space, Spin, Steps, Typography } from "antd";
import { Suspense, lazy } from "react";
import type { RefObject } from "react";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
} from "../../services/splitPromptBundle";
import { SplitRuntimeMessages } from "./SplitRuntimeMessages";
import type {
  ClusterRunState,
} from "../PrdSplitWizard/types";
import type {
  SplitPromptDraftBySlot,
  SplitRetryPhase,
  SplitRuntimeLogItem,
  SplitWizardStep,
} from "./types";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

type WizardPromptSlot =
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2;

interface Props {
  open: boolean;
  step: SplitWizardStep;
  parsing: boolean;
  starting: boolean;
  saving: boolean;
  optimizingSlot: string | null;
  loading: boolean;
  draftBySlot: SplitPromptDraftBySlot;
  runtimeLogs: SplitRuntimeLogItem[];
  clusterRuns?: ClusterRunState[];
  runtimeListRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  onStepChange: (step: SplitWizardStep) => void;
  onClose: () => void;
  onDraftChange: (slot: WizardPromptSlot, markdown: string) => void;
  onSavePrompts: () => void;
  onStartSplit: () => void;
  onOptimize: (slot: WizardPromptSlot) => void;
  onRetryStage: (phase: SplitRetryPhase) => void;
  onRetryCluster?: (clusterId: string) => void;
  onCancelCluster?: (clusterId: string) => void;
}

export function SplitPromptWizardModal({
  open,
  step,
  parsing,
  starting,
  saving,
  optimizingSlot,
  loading,
  draftBySlot,
  runtimeLogs,
  clusterRuns,
  runtimeListRef,
  retryingPhase,
  onStepChange,
  onClose,
  onDraftChange,
  onSavePrompts,
  onStartSplit,
  onOptimize,
  onRetryStage,
  onRetryCluster,
  onCancelCluster,
}: Props) {
  return (
    <Modal
      title="需求"
      open={open}
      mask={{ closable: !parsing && !starting }}
      onCancel={() => {
        if (starting || optimizingSlot) return;
        if (parsing && step === "runtime") return;
        onClose();
      }}
      width={980}
      destroyOnHidden
      styles={{
        body: step === "runtime"
          ? { maxHeight: "min(680px, 82vh)", display: "flex", flexDirection: "column", paddingTop: 8 }
          : { maxHeight: "min(720px, 82vh)", overflowY: "auto" },
      }}
      footer={step === "prompts"
        ? (
          <Space>
            <Button
              onClick={() => {
                if (starting || optimizingSlot) return;
                onClose();
              }}
              disabled={starting || saving || !!optimizingSlot}
            >
              关闭
            </Button>
            <Button
              onClick={onSavePrompts}
              loading={saving}
              disabled={starting || !!optimizingSlot}
            >
              保存提示词
            </Button>
            <Button
              type="primary"
              onClick={onStartSplit}
              loading={starting}
              disabled={saving || !!optimizingSlot}
            >
              开始拆分
            </Button>
          </Space>
        )
        : (
          <Space>
            <Button
              onClick={() => {
                if (parsing || starting) return;
                onStepChange("prompts");
              }}
              disabled={parsing || starting}
            >
              上一步
            </Button>
            <Button
              type="primary"
              onClick={() => {
                if (parsing) return;
                onClose();
              }}
            >
              完成并关闭
            </Button>
          </Space>
        )}
    >
      <Steps
        size="small"
        current={step === "prompts" ? 0 : 1}
        style={{ marginBottom: 14 }}
        items={[{ title: "提示词" }, { title: "子代理对话流" }]}
      />
      {step === "prompts"
        ? (
          <Spin spinning={loading}>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                第 1 步：编辑阶段 1/2 的系统提示词；点击「开始拆分」后在同弹窗第 2 步查看执行日志与会话信息。「保存提示词」将写入仓库级覆盖。
              </Typography.Paragraph>
              <PromptSlotRow
                title="阶段1（拆分）"
                slot={PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1}
                draft={draftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1] ?? ""}
                optimizing={optimizingSlot === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1}
                disableOptimize={!!optimizingSlot || starting || saving}
                onOptimize={onOptimize}
                onDraftChange={onDraftChange}
              />
              <PromptSlotRow
                title="阶段2（溯源）"
                slot={PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2}
                draft={draftBySlot[PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2] ?? ""}
                optimizing={optimizingSlot === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2}
                disableOptimize={!!optimizingSlot || starting || saving}
                onOptimize={onOptimize}
                onDraftChange={onDraftChange}
              />
            </Space>
          </Spin>
        )
        : (
          <div className="app-prd-task-panel__split-runtime app-prd-task-panel__split-runtime--in-modal">
            <div className="app-prd-task-panel__split-runtime-head">
              <Space size={8} align="center" className="app-prd-task-panel__split-runtime-head-title">
                <Typography.Text type="secondary">
                  第 2 步：主会话派发子代理，点击子代理可查看对话流；失败项可重试对应阶段。
                </Typography.Text>
                {parsing ? <Spin size="small" aria-label="拆分进行中" /> : null}
              </Space>
            </div>
	            <SplitRuntimeMessages
	              logs={runtimeLogs}
	              clusterRuns={clusterRuns}
	              listRef={runtimeListRef}
	              retryingPhase={retryingPhase}
	              onRetryStage={onRetryStage}
	              onRetryCluster={onRetryCluster}
	              onCancelCluster={onCancelCluster}
	            />
          </div>
        )}
    </Modal>
  );
}

interface SlotRowProps {
  title: string;
  slot: WizardPromptSlot;
  draft: string;
  optimizing: boolean;
  disableOptimize: boolean;
  onOptimize: (slot: WizardPromptSlot) => void;
  onDraftChange: (slot: WizardPromptSlot, markdown: string) => void;
}

function PromptSlotRow({
  title,
  slot,
  draft,
  optimizing,
  disableOptimize,
  onOptimize,
  onDraftChange,
}: SlotRowProps) {
  return (
    <>
      <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
        <Typography.Text strong>{title}</Typography.Text>
        <Button
          size="small"
          loading={optimizing}
          disabled={disableOptimize}
          onClick={() => onOptimize(slot)}
        >
          AI优化
        </Button>
      </Space>
      <div className="app-prd-task-panel__split-prompt-milkdown">
        <Suspense fallback={null}>
          <MilkdownEditor
            floatingToolbar={false}
            text={draft}
            onChange={(markdown) => onDraftChange(slot, markdown)}
          />
        </Suspense>
      </div>
    </>
  );
}
