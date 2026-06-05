import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_AT_MENTION_DEFAULT_TARGET,
  type AtMentionDefaultTarget,
} from "../constants/atMentionDefault";
import {
  loadAtMentionDefaultTargetFromStore,
  saveAtMentionDefaultTargetToStore,
  WISE_AT_MENTION_DEFAULT_CHANGED,
} from "../services/wiseDefaultConfigStore";

export function useAtMentionDefaultTarget() {
  const [target, setTarget] = useState<AtMentionDefaultTarget>(DEFAULT_AT_MENTION_DEFAULT_TARGET);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadAtMentionDefaultTargetFromStore();
      setTarget(loaded);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ atMentionDefaultTarget: AtMentionDefaultTarget }>).detail;
      if (detail?.atMentionDefaultTarget) {
        setTarget(detail.atMentionDefaultTarget);
      }
    };
    window.addEventListener(WISE_AT_MENTION_DEFAULT_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_AT_MENTION_DEFAULT_CHANGED, onChanged as EventListener);
    };
  }, []);

  const save = useCallback(
    async (next: AtMentionDefaultTarget) => {
      if (JSON.stringify(next) === JSON.stringify(target)) return;
      setSaving(true);
      try {
        await saveAtMentionDefaultTargetToStore(next);
        setTarget(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [target],
  );

  return { target, loading, saving, refresh, save };
}
