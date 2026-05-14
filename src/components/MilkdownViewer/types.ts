export interface MilkdownTaskAnchorMarker {
  taskId: string;
  /** Display label, usually derived from the numeric segment in taskId. */
  label: string;
}

export interface MilkdownTaskAnchor {
  key: string;
  searchText: string;
  markers: MilkdownTaskAnchorMarker[];
  /** Optional resolved range cache, used to keep anchors stable across editor transactions. */
  range?: AnchorRange;
  /** Structured anchor descriptor emitted by the PRD task splitter. */
  descriptor?: {
    from: number;
    to: number;
    textHash: string;
    contextBefore: string;
    contextAfter: string;
  };
}

export interface AnchorRange {
  from: number;
  to: number;
}
