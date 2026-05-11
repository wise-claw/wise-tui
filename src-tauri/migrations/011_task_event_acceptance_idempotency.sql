-- 验收 verdict 事件幂等：同 task + eventType + graphNodeId + correlationId 只保留一条
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_acceptance_corr_unique
ON task_events (
  task_id,
  event_type,
  json_extract(payload_json, '$.graphNodeId'),
  json_extract(payload_json, '$.correlationId')
)
WHERE event_type IN ('workflow_acceptance_verdict_submitted', 'workflow_acceptance_verdict_unresolved')
  AND json_extract(payload_json, '$.graphNodeId') IS NOT NULL
  AND json_extract(payload_json, '$.correlationId') IS NOT NULL;
