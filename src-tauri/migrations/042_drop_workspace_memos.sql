-- Migration 042: Workspace memos feature removed; drop legacy memo tables and settings keys.

DROP TABLE IF EXISTS workspace_memo_scope_prefs;
DROP TABLE IF EXISTS workspace_memos;

DELETE FROM app_settings WHERE key LIKE 'wise.workspaceMemos.%';
