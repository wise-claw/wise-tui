export interface TiptapTaskAnchorMarker {
  taskId: string;
  /** 展示标签，通常由 taskId 中的数字段派生。 */
  label: string;
}

export interface TiptapTaskAnchor {
  key: string;
  searchText: string;
  markers: TiptapTaskAnchorMarker[];
  /** 可选的位置缓存，用于在文档事务间保持锚点稳定。 */
  range?: TiptapAnchorRange;
  /** 结构化锚点描述（PRD 拆分器产出）。 */
  descriptor?: {
    from: number;
    to: number;
    textHash: string;
    contextBefore: string;
    contextAfter: string;
  };
}

export interface TiptapAnchorRange {
  from: number;
  to: number;
}

export interface TiptapSelectedAnchorDraft {
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
}
