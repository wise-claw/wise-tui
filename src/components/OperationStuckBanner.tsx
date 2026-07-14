import { Alert, Button } from "antd";
import { useSyncExternalStore } from "react";
import {
  dismissStuckOperations,
  getStuckOperationsSnapshot,
  subscribeTrackedOperations,
} from "../stores/operationWatchdogStore";
import "./OperationStuckBanner.css";

export function OperationStuckBanner() {
  const stuck = useSyncExternalStore(
    subscribeTrackedOperations,
    getStuckOperationsSnapshot,
    getStuckOperationsSnapshot,
  );

  if (stuck.length === 0) return null;

  const labels = stuck.map((op) => op.label).join("、");

  return (
    <div className="app-operation-stuck-banner" role="status" aria-live="assertive">
      <Alert
        type="warning"
        showIcon
        banner
        message={
          <div className="app-operation-stuck-banner__row">
            <span className="app-operation-stuck-banner__text">
              有操作卡住，Wise 可能短暂不可点：{labels}
            </span>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                dismissStuckOperations();
              }}
            >
              解除阻塞
            </Button>
          </div>
        }
      />
    </div>
  );
}
