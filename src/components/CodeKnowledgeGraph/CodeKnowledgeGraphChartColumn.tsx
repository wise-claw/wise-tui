import { memo, useImperativeHandle, useRef, forwardRef } from "react";
import type {
  CodeGraphSubgraphHopScope,
  CodeGraphSubgraphResponse,
  GraphNode,
} from "../../types/codeKnowledgeGraph";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import "./CodeKnowledgeGraphPanel.css";

export type SubgraphHopScope = CodeGraphSubgraphHopScope;

export const HOP_SELECT_OPTIONS: { label: string; value: SubgraphHopScope }[] = [
  { label: "全部", value: "all" },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n) => ({
    label: `hop ${n}`,
    value: n,
  })),
];

export type CodeKnowledgeGraphChartColumnHandle = Pick<GraphCanvasHandle, "focusNodeById">;

interface Props {
  subgraphData: CodeGraphSubgraphResponse;
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
  onStageClick: () => void;
  /** 与工具栏 hop 一致，用于浮层按钮提示（如「hop 3」「全部」） */
  subgraphHopLabel: string;
  /**
   * 有限 hop（非「全部」）时：画布以该节点为父自上而下排布；优先选中点，由 Panel 传入 `selectedNode?.id ?? subgraphFocusId`。
   */
  layeredLayoutRootId?: string | null;
  onSubgraphRollUp: () => void;
  onSubgraphDrillDown: () => void;
  /** 与工具栏一致；有限 hop 且选中节点时用于隐藏邻域外节点 */
  subgraphHopScope: SubgraphHopScope;
}

export const CodeKnowledgeGraphChartColumn = memo(
  forwardRef<CodeKnowledgeGraphChartColumnHandle, Props>(function CodeKnowledgeGraphChartColumn(
    {
      subgraphData,
      selectedNode,
      onSelectNode,
      onStageClick,
      subgraphHopLabel,
      layeredLayoutRootId = null,
      onSubgraphRollUp,
      onSubgraphDrillDown,
      subgraphHopScope,
    },
    ref,
  ) {
    const canvasRef = useRef<GraphCanvasHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        focusNodeById: (nodeId: string) => {
          canvasRef.current?.focusNodeById(nodeId);
        },
      }),
      [],
    );

    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <GraphCanvas
            ref={canvasRef}
            data={subgraphData}
            onNodeClick={onSelectNode}
            onStageClick={onStageClick}
            selectedNode={selectedNode}
            subgraphHopLabel={subgraphHopLabel}
            layeredLayoutRootId={layeredLayoutRootId}
            onSubgraphRollUp={onSubgraphRollUp}
            onSubgraphDrillDown={onSubgraphDrillDown}
            visibilityHopLimit={subgraphHopScope}
          />
        </div>
      </div>
    );
  }),
);
