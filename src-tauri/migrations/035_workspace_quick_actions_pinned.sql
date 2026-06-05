-- 工作区快捷操作：支持固定到中栏顶栏

ALTER TABLE workspace_quick_actions
  ADD COLUMN pinned_to_topbar INTEGER NOT NULL DEFAULT 0 CHECK (pinned_to_topbar IN (0, 1));
