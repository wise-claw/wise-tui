export interface TriggerInfo {
  mode: "at" | "slash" | null;
  query: string;
  rect: DOMRect | null;
}
