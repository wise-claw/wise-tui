import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { Repository, SddMode } from "../../types";
import {
  sddStackModeFromRepositorySddMode,
  sddStackModeToBootstrap,
  sddStackModeToSddMode,
  type SddStackMode,
} from "../../constants/sddStackMode";
import { dispatchTrellisBootstrapComplete } from "../../constants/trellisUiEvents";
import { detectSddSignals, type SddSignals } from "../../services/trellis/sddModeDetector";
import { runWorkspaceBootstrap } from "../../services/workspaceBootstrap";
import { workspaceBootstrapNeedsTrellisInit } from "../../constants/workspaceBootstrapAddons";

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
  const [value, setValue] = useState<SddStackMode>("auto");
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
    setValue(sddStackModeFromRepositorySddMode(nextRepository.sddMode));
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
      const bootstrap = sddStackModeToBootstrap(value);
      const sddMode = sddStackModeToSddMode(value);
      if (bootstrap.trellis || bootstrap.trellisInit || bootstrap.omc) {
        await runWorkspaceBootstrap(repository.path, bootstrap);
      }
      await onUpdateRepositorySddMode(repository.id, sddMode);
      if (workspaceBootstrapNeedsTrellisInit(bootstrap)) {
        dispatchTrellisBootstrapComplete({ repositoryId: repository.id });
      }
      setRepository(null);
    } catch (err) {
      console.error(err);
      message.error(err instanceof Error ? err.message : "保存 SDD 模式失败");
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
