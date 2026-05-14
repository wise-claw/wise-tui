import { Button, Modal, Segmented, Space, Spin, Typography } from "antd";
import { Suspense, lazy } from "react";
import {
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1,
  PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2,
} from "../../services/splitPromptBundle";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

type RuntimePromptSlot =
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1
  | typeof PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2;

interface Props {
  open: boolean;
  linkedRepositoryId: number | null;
  loading: boolean;
  saving: boolean;
  optimizingSlot: string | null;
  slot: RuntimePromptSlot;
  draftBySlot: Record<string, string>;
  onSlotChange: (slot: RuntimePromptSlot) => void;
  onDraftChange: (slot: RuntimePromptSlot, markdown: string) => void;
  onResetToDefault: () => void;
  onCancel: () => void;
  onSave: () => void;
  onOptimize: (slot: RuntimePromptSlot) => void;
}

export function RuntimePromptEditModal({
  open,
  linkedRepositoryId,
  loading,
  saving,
  optimizingSlot,
  slot,
  draftBySlot,
  onSlotChange,
  onDraftChange,
  onResetToDefault,
  onCancel,
  onSave,
  onOptimize,
}: Props) {
  const slotIsPhase1 = slot === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1;
  return (
    <Modal
      title="拆分执行提示词"
      open={open}
      onCancel={() => {
        if (optimizingSlot) return;
        onCancel();
      }}
      width={920}
      destroyOnHidden
      footer={(
        <Space wrap>
          <Button
            onClick={onResetToDefault}
            disabled={!linkedRepositoryId || loading || saving || !!optimizingSlot}
          >
            恢复默认
          </Button>
          <Button onClick={onCancel} disabled={saving || !!optimizingSlot}>
            关闭
          </Button>
          <Button
            type="primary"
            onClick={onSave}
            loading={saving}
            disabled={!!optimizingSlot}
          >
            保存
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        这里展示并编辑拆分执行时实际使用的阶段提示词（仓库级覆盖）。当前仅编辑系统提示词正文。
      </Typography.Paragraph>
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Segmented
          size="small"
          value={slot}
          options={[
            { label: "阶段1（拆分）", value: PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1 },
            { label: "阶段2（溯源）", value: PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2 },
          ]}
          onChange={(value) => {
            if (
              value === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE1
              || value === PROMPT_SLOT_PRD_TASK_SPLIT_PHASE2
            ) {
              onSlotChange(value);
            }
          }}
        />
        <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Text strong>
            {slotIsPhase1 ? "阶段1（拆分）提示词" : "阶段2（溯源）提示词"}
          </Typography.Text>
          <Button
            size="small"
            loading={optimizingSlot === slot}
            disabled={!!optimizingSlot || saving || loading}
            onClick={() => onOptimize(slot)}
          >
            AI优化
          </Button>
        </Space>
        <Spin spinning={loading}>
          <div className="app-prd-task-panel__split-prompt-milkdown">
            <Suspense fallback={null}>
              <MilkdownEditor
                floatingToolbar={false}
                text={draftBySlot[slot] ?? ""}
                onChange={(markdown) => onDraftChange(slot, markdown)}
              />
            </Suspense>
          </div>
        </Spin>
      </Space>
    </Modal>
  );
}
