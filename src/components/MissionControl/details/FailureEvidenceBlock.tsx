import { Button, Typography, message } from "antd";
import { CopyOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import { openPath } from "@tauri-apps/plugin-opener";
import type { DispatchClusterRawOutput } from "../../../services/prdSplit/splitterDispatch";

interface FailureEvidenceBlockProps {
  raw: DispatchClusterRawOutput | null;
  error?: {
    summary: string;
    exitCode: number | null;
    stdoutPath: string;
    stderrPath: string;
  } | null;
  clusterId: string;
  onRetryFromRunDir?: (runId: string, clusterId: string) => void;
}

interface EvidenceRow {
  label: string;
  value: string;
  openable: boolean;
}

export function FailureEvidenceBlock({
  raw,
  error,
  clusterId,
  onRetryFromRunDir,
}: FailureEvidenceBlockProps) {
  const runId = raw?.runId?.trim() ?? "";
  const rows: EvidenceRow[] = [
    { label: "Exit code", value: String(raw?.exitCode ?? error?.exitCode ?? "unknown"), openable: false },
    { label: "stdout", value: raw?.stdoutPath || error?.stdoutPath || "", openable: true },
    { label: "stderr", value: raw?.stderrPath || error?.stderrPath || "", openable: true },
    { label: "runDir", value: raw?.runDir || "", openable: true },
  ];
  const canRetry = Boolean(runId && raw?.runDir && onRetryFromRunDir);

  return (
    <section className="mission-failure-evidence">
      <div className="mission-failure-evidence__header">
        <div>
          <Typography.Text className="mission-evidence-section__title">Failure evidence</Typography.Text>
          {error?.summary ? (
            <Typography.Paragraph type="secondary" className="mission-failure-evidence__summary">
              {error.summary}
            </Typography.Paragraph>
          ) : null}
        </div>
        {canRetry ? (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => onRetryFromRunDir?.(runId, clusterId)}
          >
            Retry from runDir
          </Button>
        ) : null}
      </div>
      <div className="mission-failure-evidence__rows">
        {rows.map((row) => (
          <div key={row.label} className="mission-failure-evidence__row">
            <span className="mission-failure-evidence__label">{row.label}</span>
            <Typography.Text code ellipsis={{ tooltip: row.value || "N/A" }} className="mission-failure-evidence__value">
              {row.value || "N/A"}
            </Typography.Text>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              disabled={!row.value}
              aria-label={`Copy ${row.label}`}
              onClick={() => copyPath(row.value)}
            />
            {row.openable ? (
              <Button
                size="small"
                type="text"
                icon={<FolderOpenOutlined />}
                disabled={!row.value}
                aria-label={`Open ${row.label}`}
                onClick={() => openEvidencePath(row.value)}
              />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

async function copyPath(value: string): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    message.success("Path copied");
  } catch {
    message.error("Copy failed");
  }
}

async function openEvidencePath(value: string): Promise<void> {
  if (!value) return;
  try {
    await openPath(value);
  } catch {
    message.error("Open failed");
  }
}
