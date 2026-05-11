-- 项目侧栏角标：自定义首字来源与颜色
ALTER TABLE projects ADD COLUMN icon_display_name TEXT NULL;
ALTER TABLE projects ADD COLUMN icon_color TEXT NULL;
