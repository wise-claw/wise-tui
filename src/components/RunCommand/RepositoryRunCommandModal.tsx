import { Modal } from "antd";
import { useMemo, useSyncExternalStore } from "react";
import { useRepositoryRunCommand } from "../../hooks/useRepositoryRunCommand";
import {
  closeRepositoryRunCommandModal,
  getRepositoryRunCommandModalSnapshot,
  subscribeRepositoryRunCommandModal,
} from "../../stores/repositoryRunCommandModalStore";
import type { Repository } from "../../types";
import { RunCommandPanel } from "./RunCommandPanel";
import "./repositoryRunCommandModal.css";

export type RepositoryRunCommandModalProps = {
  repositories: Repository[];
  onAutoFixRunError?: (prompt: string) => void;
};

export function RepositoryRunCommandModal({
  repositories,
  onAutoFixRunError,
}: RepositoryRunCommandModalProps) {
  const { open, target } = useSyncExternalStore(
    subscribeRepositoryRunCommandModal,
    getRepositoryRunCommandModalSnapshot,
    getRepositoryRunCommandModalSnapshot,
  );

  const repository = useMemo(() => {
    if (!target) return null;
    return repositories.find((item) => item.id === target.repositoryId) ?? null;
  }, [repositories, target]);

  const runCwd = (target?.repositoryPath ?? repository?.path ?? "").trim();

  const run = useRepositoryRunCommand({
    repository,
    runCwd,
    onAutoFixRunError,
    onRequestOpenPanel: () => {
      /* modal already open */
    },
  });

  return (
    <Modal
      open={open}
      onCancel={closeRepositoryRunCommandModal}
      footer={null}
      closable={false}
      centered
      width={320}
      destroyOnHidden
      className="app-run-command-modal"
      title={null}
      maskClosable
    >
      <RunCommandPanel {...run} onClose={closeRepositoryRunCommandModal} />
    </Modal>
  );
}
