-- 气泡合并间隔（毫秒）与勿扰截止时间（Unix 毫秒，NULL 表示未开启）

ALTER TABLE mascot_prefs ADD COLUMN toast_merge_ms INTEGER;
UPDATE mascot_prefs SET toast_merge_ms = 80 WHERE id = 1 AND toast_merge_ms IS NULL;

ALTER TABLE mascot_prefs ADD COLUMN dnd_until_ms INTEGER;
