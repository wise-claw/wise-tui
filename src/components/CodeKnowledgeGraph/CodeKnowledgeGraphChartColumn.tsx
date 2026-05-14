import { memo, useImperativeHandle, useRef, forwardRef } from "react";
import type {
  CodeGraphSubgraphHopDepth,
  CodeGraphSubgraphResponse,
  GraphNode,
} from "../../types/codeKnowledgeGraph";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import "./CodeKnowledgeGraphPanel.css";

export type SubgraphHopScope = "all" | CodeGraphSubgraphHopDepth;

export const HOP_SELECT_OPTIONS: { label: string; value: SubgraphHopScope }[] = [
  { label: "全部", value: "all" },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n) => ({
    label: `${n} 跳`,
    value: n,
  })),
];

export type CodeKnowledgeGraphChartColumnHandle = Pick<GraphCanvasHandle, "focusNodeById">;

interface Props {
  subgraphData: CodeGraphSubgraphResponse;
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
  onStageClick: () => void;
  /** 与工具栏「范围」一致，用于浮层按钮提示 */
  subgraphHopLabel: string;
  onSubgraphRollUp: () => void;
  onSubgraphDrillDown: () => void;
}

export const CodeKnowledgeGraphChartColumn = memo(
  forwardRef<CodeKnowledgeGraphChartColumnHandle, Props>(function CodeKnowledgeGraphChartColumn(
    {
      subgraphData,
      selectedNode,
      onSelectNode,
      onStageClick,
      subgraphHopLabel,
      onSubgraphRollUp,
      onSubgraphDrillDown,
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
            onSubgraphRollUp={onSubgraphRollUp}
            onSubgraphDrillDown={onSubgraphDrillDown}
          />
        </div>
      </div>
    );
  }),
);
