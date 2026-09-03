import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  getRepositoryRunCommandModalSnapshot,
  subscribeRepositoryRunCommandModal,
} from "../../stores/repositoryRunCommandModalStore";
import type { Repository } from "../../types";

const LazyRepositoryRunCommandModal = lazy(() =>
  import("./RepositoryRunCommandModal").then((module) => ({
    default: module.RepositoryRunCommandModal,
  })),
);

export type RepositoryRunCommandModalHostProps = {
  repositories: Repository[];
  onAutoFixRunError?: (prompt: string) => void | boolean | Promise<void | boolean>;
};

/** 轻量宿主：仅在首次打开运行命令弹窗时加载检测、终端与完整面板代码。 */
export function RepositoryRunCommandModalHost(props: RepositoryRunCommandModalHostProps) {
  const { open } = useSyncExternalStore(
    subscribeRepositoryRunCommandModal,
    getRepositoryRunCommandModalSnapshot,
    getRepositoryRunCommandModalSnapshot,
  );
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <LazyRepositoryRunCommandModal {...props} />
    </Suspense>
  );
}
