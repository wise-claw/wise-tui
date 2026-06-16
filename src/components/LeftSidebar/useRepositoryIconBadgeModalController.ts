import { App as AntdApp } from "antd";
import { useCallback, useState } from "react";
import type { Repository } from "../../types";
import type { RepositoryIconBadgePatch } from "../../services/repository";

interface UseRepositoryIconBadgeModalControllerInput {
  onUpdateRepositoryIconBadge?: (
    repositoryId: number,
    patch: RepositoryIconBadgePatch,
  ) => void | Promise<void>;
}

export function useRepositoryIconBadgeModalController({
  onUpdateRepositoryIconBadge,
}: UseRepositoryIconBadgeModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [repository, setRepository] = useState<Repository | null>(null);
  const [saving, setSaving] = useState(false);

  const open = useCallback((nextRepository: Repository) => {
    setRepository(nextRepository);
  }, []);

  const cancel = useCallback(() => {
    setRepository(null);
  }, []);

  const submit = useCallback(
    async (patch: RepositoryIconBadgePatch) => {
      if (!repository || !onUpdateRepositoryIconBadge) {
        setRepository(null);
        return;
      }
      setSaving(true);
      try {
        await onUpdateRepositoryIconBadge(repository.id, patch);
        setRepository(null);
      } catch (err) {
        console.error(err);
        message.error(err instanceof Error ? err.message : "保存角标配置失败");
      } finally {
        setSaving(false);
      }
    },
    [message, onUpdateRepositoryIconBadge, repository],
  );

  return {
    repository,
    saving,
    canSave: Boolean(onUpdateRepositoryIconBadge),
    open,
    cancel,
    submit,
  };
}
