-- 项目内仓库显示顺序（拖拽排序）

ALTER TABLE project_repositories ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

UPDATE project_repositories AS pr
SET display_order = sub.ord
FROM (
  SELECT
    project_id,
    repository_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY created_at ASC, repository_id ASC
    ) - 1 AS ord
  FROM project_repositories
) AS sub
WHERE pr.project_id = sub.project_id AND pr.repository_id = sub.repository_id;

CREATE INDEX IF NOT EXISTS idx_project_repositories_display_order
  ON project_repositories (project_id, display_order);
