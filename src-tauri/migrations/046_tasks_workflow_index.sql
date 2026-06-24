-- tasks 按 workflow_id 过滤（删除工作流前的进行中任务校验、列举工作流任务等）
-- 是高频路径，加索引加速。
CREATE INDEX IF NOT EXISTS idx_tasks_workflow
ON tasks (workflow_id);
