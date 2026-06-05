import { memo, useCallback, type MouseEvent } from "react";
import {
  GIT_GRAPH_NODE_RADIUS_PX,
  GIT_GRAPH_NODE_SELECTED_RADIUS_PX,
  type GitGraphRenderEdge,
  type GitGraphRenderNode,
} from "./gitGraphLayout";

interface GraphSvgLayerProps {
  width: number;
  height: number;
  edges: GitGraphRenderEdge[];
  nodes: GitGraphRenderNode[];
  selectedSha: string | null;
  onSelectCommit: (sha: string) => void;
}

export const GraphSvgLayer = memo(function GraphSvgLayer({
  width,
  height,
  edges,
  nodes,
  selectedSha,
  onSelectCommit,
}: GraphSvgLayerProps) {
  const handleNodeClick = useCallback(
    (event: MouseEvent<SVGCircleElement>, sha: string) => {
      event.stopPropagation();
      onSelectCommit(sha);
    },
    [onSelectCommit],
  );

  return (
    <svg className="git-graph-svg" width={width} height={height} aria-hidden>
      {edges.map((edge) => (
        <path
          key={`${edge.fromSha}-${edge.toSha}-${edge.fromLane}-${edge.toLane}`}
          className="git-graph-edge"
          stroke={edge.strokeColor}
          d={edge.pathD}
        />
      ))}
      {nodes.map((node) => {
        const isSelected = selectedSha === node.sha;
        const nodeRadius = isSelected
          ? GIT_GRAPH_NODE_SELECTED_RADIUS_PX
          : GIT_GRAPH_NODE_RADIUS_PX;
        return (
          <circle
            key={node.sha}
            className={`git-graph-node git-graph-node--clickable${isSelected ? " git-graph-node--selected" : ""}`}
            cx={node.cx}
            cy={node.cy}
            r={nodeRadius}
            fill={node.fill}
            stroke={isSelected ? "var(--ant-color-bg-container)" : node.fill}
            onClick={(event) => handleNodeClick(event, node.sha)}
          />
        );
      })}
    </svg>
  );
});
