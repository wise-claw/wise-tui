-- 工作区快捷操作：用户自定义分类（与仓库/工作区归属无关）

ALTER TABLE workspace_quick_actions
  ADD COLUMN category TEXT NOT NULL DEFAULT '';
