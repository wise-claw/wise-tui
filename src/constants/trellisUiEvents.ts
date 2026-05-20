export const TRELLIS_UI_EVENT_BOOTSTRAP_COMPLETE = "wise-trellis-bootstrap-complete";

export type TrellisBootstrapCompleteDetail = {
  projectId?: string;
  repositoryId?: number;
};

export function dispatchTrellisBootstrapComplete(detail?: TrellisBootstrapCompleteDetail): void {
  window.dispatchEvent(
    new CustomEvent(TRELLIS_UI_EVENT_BOOTSTRAP_COMPLETE, { detail }),
  );
}
