export const GIT_GRAPH_LANE_WIDTH_PX = 14;
/** Cap graph column width so commit rows keep readable space beside the lanes. */
export const GIT_GRAPH_MAX_WIDTH_PX = 112;
export const GIT_GRAPH_ROW_HEIGHT_PX = 40;
export const GIT_GRAPH_NODE_RADIUS_PX = 4;
export const GIT_GRAPH_NODE_SELECTED_RADIUS_PX = 5;

export interface GitGraphLayoutInput {
  sha: string;
  parentShas: string[];
}

export interface GitGraphLayoutRow extends GitGraphLayoutInput {
  lane: number;
  parentLanes: number[];
  laneColumns: number;
}

export interface GitGraphEdge {
  fromSha: string;
  toSha: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  /** Lane used for edge stroke color (branch color in Git Graph). */
  strokeLane: number;
}

export interface GitGraphLayoutResult {
  rows: GitGraphLayoutRow[];
  edges: GitGraphEdge[];
  laneColumns: number;
}

class GitGraphLanePool {
  private nextLane = 0;

  private freeLanes: number[] = [];

  acquire(): number {
    const recycled = this.freeLanes.pop();
    if (recycled !== undefined) {
      return recycled;
    }
    const lane = this.nextLane;
    this.nextLane += 1;
    return lane;
  }

  release(lane: number): void {
    if (lane < 0) {
      return;
    }
    this.freeLanes.push(lane);
    this.freeLanes.sort((left, right) => left - right);
  }

  get maxLaneExclusive(): number {
    return this.nextLane;
  }
}

export function computeGitGraphLayout(commits: GitGraphLayoutInput[]): GitGraphLayoutResult {
  if (commits.length === 0) {
    return { rows: [], edges: [], laneColumns: 1 };
  }

  const shaToRow = new Map<string, number>();
  commits.forEach((commit, index) => {
    shaToRow.set(commit.sha, index);
  });

  const active = new Map<number, string>();
  const lanePool = new GitGraphLanePool();
  let maxLaneColumns = 1;
  const rows: GitGraphLayoutRow[] = [];

  for (const commit of commits) {
    const convergingLanes: number[] = [];
    for (const [activeLane, expectedSha] of [...active.entries()]) {
      if (expectedSha === commit.sha) {
        convergingLanes.push(activeLane);
        active.delete(activeLane);
      }
    }

    let lane = -1;
    if (convergingLanes.length > 0) {
      lane = Math.min(...convergingLanes);
      for (const extraLane of convergingLanes) {
        if (extraLane !== lane) {
          lanePool.release(extraLane);
        }
      }
    } else {
      const hasLoadedParent = commit.parentShas.some((parentSha) => shaToRow.has(parentSha));
      lane = hasLoadedParent ? lanePool.acquire() : 0;
    }

    const parentLanes: number[] = [];
    const parents = commit.parentShas;
    for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
      const parentSha = parents[parentIndex]!;
      if (!shaToRow.has(parentSha)) {
        parentLanes.push(-1);
        continue;
      }

      if (parentIndex === 0) {
        parentLanes.push(lane);
        active.set(lane, parentSha);
        continue;
      }

      const forkLane = lanePool.acquire();
      parentLanes.push(forkLane);
      active.set(forkLane, parentSha);
    }

    const laneColumns = Math.max(
      lanePool.maxLaneExclusive,
      lane + 1,
      ...Array.from(active.keys(), (activeLane) => activeLane + 1),
      1,
    );
    maxLaneColumns = Math.max(maxLaneColumns, laneColumns);

    rows.push({
      ...commit,
      lane,
      parentLanes,
      laneColumns,
    });
  }

  const edges: GitGraphEdge[] = [];
  rows.forEach((row, fromRow) => {
    row.parentShas.forEach((parentSha, parentIndex) => {
      const toRow = shaToRow.get(parentSha);
      if (toRow === undefined) {
        return;
      }
      const fromLane = row.lane;
      if (fromLane < 0) {
        return;
      }
      const targetRow = rows[toRow];
      if (!targetRow) {
        return;
      }
      const toLane = targetRow.lane;
      const strokeLane =
        parentIndex > 0 && fromLane !== toLane ? toLane : fromLane;
      edges.push({
        fromSha: row.sha,
        toSha: parentSha,
        fromRow,
        toRow,
        fromLane,
        toLane,
        strokeLane,
      });
    });
  });

  return compactGitGraphLaneIndices({ rows, edges, laneColumns: maxLaneColumns });
}

function compactGitGraphLaneIndices(result: GitGraphLayoutResult): GitGraphLayoutResult {
  const usedLanes = new Set<number>();
  for (const row of result.rows) {
    usedLanes.add(row.lane);
    for (const parentLane of row.parentLanes) {
      if (parentLane >= 0) {
        usedLanes.add(parentLane);
      }
    }
  }
  for (const edge of result.edges) {
    usedLanes.add(edge.fromLane);
    usedLanes.add(edge.toLane);
    usedLanes.add(edge.strokeLane);
  }

  const sortedLanes = [...usedLanes].sort((left, right) => left - right);
  const laneRemap = new Map<number, number>(
    sortedLanes.map((lane, index) => [lane, index]),
  );

  const remapLane = (lane: number): number => laneRemap.get(lane) ?? lane;

  const rows = result.rows.map((row) => ({
    ...row,
    lane: remapLane(row.lane),
    parentLanes: row.parentLanes.map((parentLane) => (parentLane >= 0 ? remapLane(parentLane) : parentLane)),
    laneColumns: sortedLanes.length,
  }));

  const edges = result.edges.map((edge) => ({
    ...edge,
    fromLane: remapLane(edge.fromLane),
    toLane: remapLane(edge.toLane),
    strokeLane: remapLane(edge.strokeLane),
  }));

  return {
    rows,
    edges,
    laneColumns: Math.max(sortedLanes.length, 1),
  };
}

export function resolveGitGraphLaneWidthPx(laneColumns: number): number {
  const columns = Math.max(laneColumns, 1);
  return Math.min(GIT_GRAPH_LANE_WIDTH_PX, GIT_GRAPH_MAX_WIDTH_PX / columns);
}

export function resolveGitGraphDisplayWidthPx(laneColumns: number): number {
  const columns = Math.max(laneColumns, 1);
  return Math.min(columns * GIT_GRAPH_LANE_WIDTH_PX, GIT_GRAPH_MAX_WIDTH_PX);
}

export function gitGraphLaneCenterX(lane: number, laneWidthPx = GIT_GRAPH_LANE_WIDTH_PX): number {
  return lane * laneWidthPx + laneWidthPx / 2;
}

export function gitGraphRowCenterY(rowIndex: number): number {
  return rowIndex * GIT_GRAPH_ROW_HEIGHT_PX + GIT_GRAPH_ROW_HEIGHT_PX / 2;
}

/** Git Graph–style lane palette (vivid, distinguishable on light backgrounds). */
export const GIT_GRAPH_LANE_COLORS = [
  "#8b5cf6",
  "#22c55e",
  "#f97316",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#6366f1",
  "#ef4444",
  "#06b6d4",
] as const;

export function gitGraphLaneColor(lane: number): string {
  return GIT_GRAPH_LANE_COLORS[lane % GIT_GRAPH_LANE_COLORS.length] ?? GIT_GRAPH_LANE_COLORS[0];
}

export function buildGitGraphEdgePath(
  fromRow: number,
  fromLane: number,
  toRow: number,
  toLane: number,
  laneWidthPx = GIT_GRAPH_LANE_WIDTH_PX,
): string {
  const x1 = gitGraphLaneCenterX(fromLane, laneWidthPx);
  const y1 = gitGraphRowCenterY(fromRow);
  const x2 = gitGraphLaneCenterX(toLane, laneWidthPx);
  const y2 = gitGraphRowCenterY(toRow);

  if (fromLane === toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export interface GitGraphRenderEdge extends GitGraphEdge {
  pathD: string;
  strokeColor: string;
}

export interface GitGraphRenderNode {
  sha: string;
  rowIndex: number;
  cx: number;
  cy: number;
  fill: string;
}

export function buildGitGraphRenderArtifacts(
  layout: GitGraphLayoutResult,
  laneWidthPx: number,
): { edges: GitGraphRenderEdge[]; nodes: GitGraphRenderNode[] } {
  const edges = layout.edges.map((edge) => ({
    ...edge,
    pathD: buildGitGraphEdgePath(
      edge.fromRow,
      edge.fromLane,
      edge.toRow,
      edge.toLane,
      laneWidthPx,
    ),
    strokeColor: gitGraphLaneColor(edge.strokeLane),
  }));
  const nodes = layout.rows.map((row, rowIndex) => ({
    sha: row.sha,
    rowIndex,
    cx: row.lane * laneWidthPx + laneWidthPx / 2,
    cy: gitGraphRowCenterY(rowIndex),
    fill: gitGraphLaneColor(row.lane),
  }));
  return { edges, nodes };
}

const REF_COLOR_PALETTE = GIT_GRAPH_LANE_COLORS;

export function gitGraphRefColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return REF_COLOR_PALETTE[hash % REF_COLOR_PALETTE.length] ?? REF_COLOR_PALETTE[0];
}
