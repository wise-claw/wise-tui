-- 项目作为 Trellis SDD 根目录：持有 rootPath、sddMode、mainAgent
ALTER TABLE projects ADD COLUMN root_path TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN sdd_mode TEXT NOT NULL DEFAULT 'wise_trellis';
ALTER TABLE projects ADD COLUMN main_agent TEXT;
