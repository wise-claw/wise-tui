import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadComposerDefaultInstructionFromStore,
  saveComposerDefaultInstructionToStore,
  WISE_COMPOSER_DEFAULT_INSTRUCTION_CHANGED,
} from "../services/wiseDefaultConfigStore";

export function useComposerDefaultInstruction() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setText(await loadComposerDefaultInstructionFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ composerDefaultInstruction?: string }>).detail;
      if (typeof detail?.composerDefaultInstruction === "string") {
        setText(detail.composerDefaultInstruction);
      }
    };
    window.addEventListener(WISE_COMPOSER_DEFAULT_INSTRUCTION_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(
        WISE_COMPOSER_DEFAULT_INSTRUCTION_CHANGED,
        onChanged as EventListener,
      );
    };
  }, []);

  const save = useCallback(async (next: string) => {
    setSaving(true);
    try {
      const saved = await saveComposerDefaultInstructionToStore(next);
      setText(saved);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return { text, loading, saving, save, refresh };
}
