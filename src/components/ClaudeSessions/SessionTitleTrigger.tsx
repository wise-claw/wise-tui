import { useState } from "react";
import { Input, Modal, message } from "antd";
import type { ClaudeSession } from "../../types";
import { sidebarSessionPreferenceKey, updateSidebarSessionPreference, useSidebarSessionPreferences } from "../../stores/sidebarSessionPreferencesStore";
import { getSessionPreview } from "./claudeChatHelpers";

/** 第一屏标题与侧栏共享别名，编辑时固定目标，避免切会话后误改。 */
export function SessionTitleTrigger({ session }: { session: ClaudeSession }) {
  const preferences = useSidebarSessionPreferences();
  const key = sidebarSessionPreferenceKey(session.repositoryPath, session);
  const title = preferences[key]?.title || getSessionPreview(session);
  const [editing, setEditing] = useState<{ key: string; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!editing?.title.trim() || saving) return;
    setSaving(true);
    try {
      await updateSidebarSessionPreference(editing.key, { title: editing.title.trim() });
      setEditing(null);
    } catch { message.error("保存会话名称失败"); }
    finally { setSaving(false); }
  };
  return <>
    <button type="button" className="app-topbar-session-title" title={`${title}（点击重命名）`}
      aria-label={`重命名会话：${title}`} onClick={() => setEditing({ key, title })}>
      {title}
    </button>
    <Modal title="重命名会话" open={Boolean(editing)} destroyOnHidden okText="保存" cancelText="取消"
      confirmLoading={saving} okButtonProps={{ disabled: !editing?.title.trim() }}
      onOk={save} onCancel={() => { if (!saving) setEditing(null); }}>
      <Input autoFocus aria-label="会话名称" maxLength={200} placeholder="输入会话名称"
        value={editing?.title ?? ""} disabled={saving} onPressEnter={() => { void save(); }}
        onChange={(event) => setEditing((current) => current ? { ...current, title: event.target.value } : null)} />
    </Modal>
  </>;
}
