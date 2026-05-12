import { Button, Typography } from "antd";
import { Suspense, lazy } from "react";
import type { TaskAiMode } from "./helpers";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

interface Props {
  mode: TaskAiMode;
  promptText: string;
  optimizedText: string;
  actionLoading: boolean;
  saving: boolean;
  optimizedReady: boolean;
  onPromptChange: (markdown: string) => void;
  onOptimizedTextChange: (markdown: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onSaveOptimized: () => void;
}

export function TaskAiPopoverContent({
  mode,
  promptText,
  optimizedText,
  actionLoading,
  saving,
  optimizedReady,
  onPromptChange,
  onOptimizedTextChange,
  onClose,
  onSubmit,
  onSaveOptimized,
}: Props) {
  const isOptimizeMode = mode === "optimize";
  return (
    <div
      className="app-prd-task-panel__task-ai-popover-content"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="app-prd-task-panel__task-ai-popover-main">
        <Typography.Text strong>提示词</Typography.Text>
        <div className="app-prd-task-panel__split-prompt-milkdown">
          <Suspense fallback={null}>
            <MilkdownEditor
              floatingToolbar={false}
              text={promptText}
              onChange={onPromptChange}
            />
          </Suspense>
        </div>
        {isOptimizeMode ? (
          <>
            <Typography.Text strong>优化后任务内容</Typography.Text>
            <div className="app-prd-task-panel__split-prompt-milkdown">
              <Suspense fallback={null}>
                <MilkdownEditor
                  floatingToolbar={false}
                  text={optimizedText}
                  onChange={onOptimizedTextChange}
                />
              </Suspense>
            </div>
          </>
        ) : null}
      </div>
      <div className="app-prd-task-panel__task-ai-popover-actions">
        <Button
          size="small"
          disabled={actionLoading}
          onClick={onClose}
        >
          关闭
        </Button>
        <Button
          type="primary"
          size="small"
          loading={actionLoading}
          disabled={actionLoading}
          onClick={onSubmit}
        >
          {isOptimizeMode ? "优化" : "确定"}
        </Button>
        {isOptimizeMode ? (
          <Button
            size="small"
            loading={saving}
            disabled={!optimizedReady || actionLoading}
            onClick={onSaveOptimized}
          >
            保存
          </Button>
        ) : null}
      </div>
    </div>
  );
}
