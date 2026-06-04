import { message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AtMentionDefaultTarget } from "../constants/atMentionDefault";
import { encodeAtMentionDefaultSelectValue } from "../constants/atMentionDefault";
import { atMentionInsertionText } from "../utils/atMentionShortcutInsert";
import {
  formatChordForDisplay,
  isReservedComposerChord,
  normalizeChord,
} from "../utils/atMentionShortcutChord";
import {
  loadAtMentionShortcutByTargetFromStore,
  resolveAtMentionTargetFromShortcutKey,
  saveAtMentionShortcutForTarget,
  WISE_AT_MENTION_SHORTCUTS_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface AtMentionShortcutBinding {
  targetKey: string;
  target: AtMentionDefaultTarget;
  chord: string;
  insertionText: string;
  displayKeys: string;
}

function buildBindings(map: Record<string, string>): AtMentionShortcutBinding[] {
  const out: AtMentionShortcutBinding[] = [];
  for (const [targetKey, chord] of Object.entries(map)) {
    const target = resolveAtMentionTargetFromShortcutKey(targetKey);
    if (!target || !chord.trim()) continue;
    out.push({
      targetKey,
      target,
      chord,
      insertionText: atMentionInsertionText(target),
      displayKeys: formatChordForDisplay(chord),
    });
  }
  return out;
}

export function useAtMentionShortcuts() {
  const [shortcutByTarget, setShortcutByTarget] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const bindings = useMemo(() => buildBindings(shortcutByTarget), [shortcutByTarget]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setShortcutByTarget(await loadAtMentionShortcutByTargetFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ atMentionShortcutByTarget: Record<string, string> }>)
        .detail;
      if (detail?.atMentionShortcutByTarget) {
        setShortcutByTarget(detail.atMentionShortcutByTarget);
      }
    };
    window.addEventListener(WISE_AT_MENTION_SHORTCUTS_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_AT_MENTION_SHORTCUTS_CHANGED, onChanged as EventListener);
    };
  }, []);

  const saveForTarget = useCallback(
    async (target: AtMentionDefaultTarget, chord: string) => {
      const normalized = normalizeChord(chord);
      if (normalized && isReservedComposerChord(normalized)) {
        message.warning("该组合键已用于「附加文件」（⌘I / Ctrl+I），请换一组");
        return;
      }
      setSaving(true);
      try {
        const next = await saveAtMentionShortcutForTarget(target, normalized);
        setShortcutByTarget(next);
        if (normalized) {
          message.success(
            `已保存快捷键：${formatChordForDisplay(normalized)} → ${atMentionInsertionText(target)}`,
          );
        } else {
          message.success("已清除快捷键");
        }
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const chordForTarget = useCallback(
    (target: AtMentionDefaultTarget) => {
      const key = encodeAtMentionDefaultSelectValue(target);
      return shortcutByTarget[key] ?? "";
    },
    [shortcutByTarget],
  );

  return { bindings, shortcutByTarget, loading, saving, refresh, saveForTarget, chordForTarget };
}
