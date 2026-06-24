-- task_events 最高频查询为「按 task_id 取事件并按 created_at 升序」
-- （见 list_task_events / 幂等冲突回查等），加 (task_id, created_at) 复合索引
-- 可同时覆盖等值过滤与排序，避免全表扫描 + 文件排序。
CREATE INDEX IF NOT EXISTS idx_task_events_task_created
ON task_events (task_id, created_at ASC);
