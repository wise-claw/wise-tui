import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { Repository, SddMode } from "../../types";
import { detectSddSignals, type SddSignals } from "../../services/trellis/sddModeDetector";

interface UseRepositorySddModeModalControllerInput {
  onUpdateRepositorySddMode?: (repositoryId: number, sddMode: SddMode) => void | Promise<void>;
}

const EMPTY_SDD_SIGNALS: SddSignals = {
  hasTrellisTasks: false,
  hasTrellisSpec: false,
  hasOpenSpec: false,
  hasGenericSpec: false,
};

export function useRepositorySddModeModalController({
  onUpdateRepositorySddMode,
}: UseRepositorySddModeModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [repository, setRepository] = useState<Repository | null>(null);
  const [value, setValue] = useState<SddMode>("auto");
  const [saving, setSaving] = useState(false);
  const [signals, setSignals] = useState<SddSignals | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!repository) {
      setSignals(null);
      return;
    }
    setSignals(null);
    void detectSddSignals(repository.path).then(
      (nextSignals) => {
        if (!cancelled) setSignals(nextSignals);
      },
      () => {
        if (!cancelled) setSignals(EMPTY_SDD_SIGNALS);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const open = useCallback((nextRepository: Repository) => {
    setRepository(nextRepository);
    setValue(nextRepository.sddMode ?? "auto");
  }, []);

  const cancel = useCallback(() => {
    setRepository(null);
  }, []);

  const submit = useCallback(async () => {
    if (!repository || !onUpdateRepositorySddMode) {
      setRepository(null);
      return;
    }
    setSaving(true);
    try {
      await onUpdateRepositorySddMode(repository.id, value);
      message.success("SDD 模式已保存");
      setRepository(null);
    } catch (err) {
      console.error(err);
      message.error("保存 SDD 模式失败");
    } finally {
      setSaving(false);
    }
  }, [message, onUpdateRepositorySddMode, repository, value]);

  return {
    repository,
    value,
    signals,
    saving,
    canSave: Boolean(onUpdateRepositorySddMode),
    open,
    setValue,
    cancel,
    submit,
  };
}
