ALTER TABLE assistant_custom ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'conversation';
ALTER TABLE assistant_custom ADD COLUMN entry_url TEXT NOT NULL DEFAULT '';
ALTER TABLE assistant_custom ADD COLUMN entry_workflow_id TEXT;
ALTER TABLE assistant_custom ADD COLUMN entry_script TEXT NOT NULL DEFAULT '';
