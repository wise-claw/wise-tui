import { useCallback, useMemo, useState } from "react";
import { App as AntdApp } from "antd";
import type { AddRepositoryOptions, ProjectItem, Repository } from "../../types";
import type { RepositoryAcquireMode, RepositoryAcquireParams } from "../../utils/repositoryAcquire";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../../constants/workspaceBootstrapAddons";
import { pickFolder, resolveRepositoryAcquirePath } from "../../services/repository";
import {
  deriveFolderNameFromGitUrl,
  validateRepositoryAcquireParams,
} from "../../utils/repositoryAcquire";
import { yieldToUi } from "../../utils/yieldToUi";
import { buildAddRepositoryOptions } from "./RepositoryAssociateModal";

const REPO_ACQUIRE_LOADING_KEY = "wise-repo-acquire";
/** 添加/关联仓库时不再暴露角标与角色选择，统一默认前端角色。 */
const DEFAULT_REPOSITORY_TYPE: Repository["repositoryType"] = "frontend";

function acquireLoadingLabel(mode: RepositoryAcquireMode): string {
  if (mode === "git_clone") return "正在克隆仓库…";
  if (mode === "create_empty") return "正在创建空仓库…";
  if (mode === "pick_existing") return "正在选择仓库目录…";
  return "正在处理…";
}

interface UseRepositoryAssociateModalControllerInput {
  projects?: ProjectItem[];
  onAddRepositoryToProject?: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
  onAddFloatingRepository?: (
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
}

export function useRepositoryAssociateModalController({
  projects = [],
  onAddRepositoryToProject,
  onAddFloatingRepository,
}: UseRepositoryAssociateModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [floatingMode, setFloatingMode] = useState(false);
  const [workspaceBootstrapSelection, setWorkspaceBootstrapSelection] = useState(
    () => ({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION }),
  );
  const [acquireMode, setAcquireMode] = useState<RepositoryAcquireMode>("pick_existing");
  const [parentPath, setParentPath] = useState("");
  const [folderName, setFolderName] = useState("");
  const [gitUrl, setGitUrl] = useState("");

  const pendingProject = useMemo(
    () => (pendingProjectId ? projects.find((p) => p.id === pendingProjectId) ?? null : null),
    [pendingProjectId, projects],
  );

  const defaultParentPath = pendingProject?.rootPath?.trim() ?? "";

  const resetDraft = useCallback(() => {
    setWorkspaceBootstrapSelection({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION });
    setAcquireMode("pick_existing");
    setParentPath("");
    setFolderName("");
    setGitUrl("");
  }, []);

  const openAddRepositoryModal = useCallback(
    (projectId: string) => {
      setPendingProjectId(projectId);
      setFloatingMode(false);
      resetDraft();
      const project = projects.find((p) => p.id === projectId);
      if (project?.rootPath?.trim()) {
        setParentPath(project.rootPath.trim());
      }
    },
    [projects, resetDraft],
  );

  const openAddFloatingRepositoryModal = useCallback(() => {
    setPendingProjectId(null);
    setFloatingMode(true);
    resetDraft();
  }, [resetDraft]);

  const close = useCallback(() => {
    setPendingProjectId(null);
    setFloatingMode(false);
  }, []);

  const pickParentPath = useCallback(async () => {
    const picked = await pickFolder();
    if (picked) setParentPath(picked);
  }, []);

  const buildAcquireParams = useCallback((): RepositoryAcquireParams => {
    if (acquireMode === "pick_existing") {
      const existingPath = parentPath.trim();
      return {
        mode: "pick_existing",
        existingPath: existingPath.length > 0 ? existingPath : undefined,
      };
    }
    if (acquireMode === "create_empty") {
      return {
        mode: "create_empty",
        parentPath: parentPath.trim(),
        folderName: folderName.trim(),
      };
    }
    return {
      mode: "git_clone",
      parentPath: parentPath.trim(),
      gitUrl: gitUrl.trim(),
      folderName: folderName.trim() || deriveFolderNameFromGitUrl(gitUrl),
    };
  }, [acquireMode, folderName, gitUrl, parentPath]);

  const submit = useCallback(() => {
    if (!pendingProjectId && !floatingMode) return;
    const options = buildAddRepositoryOptions({
      bootstrap: workspaceBootstrapSelection,
    });
    const acquire = buildAcquireParams();
    const validationError = validateRepositoryAcquireParams(acquire);
    if (validationError) {
      message.warning(validationError);
      return;
    }

    const capturedProjectId = pendingProjectId;
    const capturedFloating = floatingMode;
    const capturedDefaultParent = defaultParentPath;

    const runAssociate = async (explicitFolderPath: string) => {
      const hideLink = message.loading({
        content: "正在关联仓库…",
        duration: 0,
        key: REPO_ACQUIRE_LOADING_KEY,
      });
      try {
        if (capturedFloating) {
          if (!onAddFloatingRepository) {
            message.warning("当前环境未启用「添加单仓」入口");
            return;
          }
          await Promise.resolve(
            onAddFloatingRepository(DEFAULT_REPOSITORY_TYPE, options, acquire, explicitFolderPath),
          );
        } else if (capturedProjectId) {
          if (!onAddRepositoryToProject) {
            message.warning("当前环境未启用「加入工作区」");
            return;
          }
          await Promise.resolve(
            onAddRepositoryToProject(
              capturedProjectId,
              DEFAULT_REPOSITORY_TYPE,
              options,
              acquire,
              explicitFolderPath,
            ),
          );
        }
      } catch (err) {
        console.error(err);
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        hideLink();
      }
    };

    close();
    const hideAcquire = message.loading({
      content: acquireLoadingLabel(acquire.mode),
      duration: 0,
      key: REPO_ACQUIRE_LOADING_KEY,
    });
    void (async () => {
      try {
        await yieldToUi();
        const resolved = await resolveRepositoryAcquirePath(acquire, {
          defaultParentPath: capturedDefaultParent || undefined,
        });
        hideAcquire();
        if (!resolved.ok) {
          if (resolved.error) message.error(resolved.error);
          return;
        }
        await runAssociate(resolved.path);
      } catch (err) {
        hideAcquire();
        console.error(err);
        message.error(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [
    buildAcquireParams,
    close,
    defaultParentPath,
    floatingMode,
    message,
    onAddFloatingRepository,
    onAddRepositoryToProject,
    pendingProjectId,
    workspaceBootstrapSelection,
  ]);

  const open = Boolean(pendingProjectId) || floatingMode;

  const submitOkText =
    acquireMode === "pick_existing"
      ? parentPath.trim()
        ? "关联"
        : "继续选择仓库目录"
      : acquireMode === "create_empty"
        ? "创建并关联"
        : "克隆并关联";

  return {
    open,
    floatingMode,
    acquireMode,
    setAcquireMode,
    parentPath,
    setParentPath,
    folderName,
    setFolderName,
    gitUrl,
    setGitUrl,
    defaultParentPath,
    pickParentPath,
    submitOkText,
    workspaceBootstrapSelection,
    setWorkspaceBootstrapSelection,
    openAddRepositoryModal,
    openAddFloatingRepositoryModal,
    close,
    submit,
  };
}
