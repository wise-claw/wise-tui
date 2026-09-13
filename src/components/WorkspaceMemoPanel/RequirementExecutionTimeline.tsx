import { Alert, Button, Spin, Tag } from "antd";
import { useRequirementExecutionRecords } from "../../hooks/useRequirementExecutionRecords";
import { REQUIREMENT_OUTCOME_LABELS, type RequirementExecutionRecord } from "../../types/requirementExecutionRecord";
import { openWorkspaceRequirementExecutionSession } from "../../stores/workspaceMemoPanelStore";

export function RequirementExecutionRecordList({ records }: { records: readonly RequirementExecutionRecord[] }) {
  return <ol className="app-requirement-execution-timeline">
    {[...records].reverse().map((record) => <li key={record.id}>
      <div className="app-requirement-execution-history__header">
        <Tag color={record.outcome === "failed" ? "error" : record.outcome === "accepted" ? "success" : "default"}>{REQUIREMENT_OUTCOME_LABELS[record.outcome]}</Tag>
        <time dateTime={new Date(record.finishedAt).toISOString()}>{new Date(record.finishedAt).toLocaleString("zh-CN", { hour12: false })}</time>
        {record.startedAt != null && <span>耗时 {Math.max(0, Math.round((record.finishedAt - record.startedAt) / 1000))} 秒</span>}
        {record.sessionId && <Button size="small" onClick={() => openWorkspaceRequirementExecutionSession(record.sessionId)}>查看会话</Button>}
      </div>
      {record.summary && <p className="app-requirement-execution-timeline__summary">{record.summary}</p>}
      {record.files.length > 0 && <details>
        <summary>涉及文件（工具记录，{record.files.length} 项）</summary>
        <ul>{record.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
      </details>}
    </li>)}
  </ol>;
}

export function RequirementExecutionTimeline({ requirementId }: { requirementId: string }) {
  const { records, loading, error, retry } = useRequirementExecutionRecords(requirementId);
  return <section aria-label="执行与验收时间线" className="app-requirement-execution-timeline-section">
    <strong>执行与验收时间线</strong>
    {loading ? <Spin size="small" /> : error ? <Alert type="error" title="执行记录加载失败" description={error} action={<Button size="small" onClick={retry}>重试</Button>} />
      : records.length ? <RequirementExecutionRecordList records={records} />
        : <p className="app-requirement-execution-history__hint">暂无逐轮记录。更新后的执行结束与验收操作会保存在这里，已有会话仍可从上方打开。</p>}
  </section>;
}
