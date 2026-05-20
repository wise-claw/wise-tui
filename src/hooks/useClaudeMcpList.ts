import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeMcpItem } from "../types";
import {
  getClaudeMcpRuntimeHealth,
  getClaudeMcpStatus,
  removeClaudeMcpServer,
  setClaudeMcpServerEnabled,
} from "../services/claude";
import {
  EMPTY_MCP_DATA,
  MCP_SECTIONS,
  filterMcpDataBySearch,
  mergeRuntimeHealth,
  patchMcpItemEnabledById,
  removeMcpItemById,
} from "../components/ClaudeMcp/claudeMcpListModel";
import { filterOmcFromMcpStatus } from "../utils/omcPluginDetect";

interface Options {
  repositoryPath?: string | null;
  active?: boolean;
  /** 未安装 OMC 时从「已安装插件」列表中剔除 OMC 相关 MCP。 */
  omcInstalled?: boolean;
  listSearch?: string;
  onCountChange?: (count: number) => void;
}

export function useClaudeMcpList({
  repositoryPath,
  active = true,
  omcInstalled = false,
  listSearch = "",
  onCountChange,
}: Options) {
  const { message, modal } = App.useApp();
  const [mcpData, setMcpData] = useState(EMPTY_MCP_DATA);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const mcpLoadGenRef = useRef(0);
  const prevProjectKeyRef = useRef<string | null>(null);
  const [mcpCacheKey, setMcpCacheKey] = useState<string | null>(null);

  const normalizedProjectKey = useMemo(() => {
    const t = repositoryPath?.trim();
    return t && t.length > 0 ? t : "";
  }, [repositoryPath]);

  useEffect(() => {
    const prev = prevProjectKeyRef.current;
    if (prev !== null && prev !== normalizedProjectKey) {
      setMcpCacheKey(null);
      setMcpData(EMPTY_MCP_DATA);
    }
    prevProjectKeyRef.current = normalizedProjectKey;
  }, [normalizedProjectKey]);

  const fetchMcpFromHost = useCallback(
    async (kind: "initial" | "refresh" | "silent") => {
      const cacheKey = normalizedProjectKey;
      const gen = ++mcpLoadGenRef.current;
      if (kind === "initial") setMcpLoading(true);
      if (kind === "refresh") setMcpRefreshing(true);
      try {
        const res = await getClaudeMcpStatus(repositoryPath ?? null);
        if (gen !== mcpLoadGenRef.current) return;
        setMcpData(res);
        setMcpError(null);
        setMcpCacheKey(cacheKey);
        void getClaudeMcpRuntimeHealth(repositoryPath ?? null)
          .then((health) => {
            if (gen !== mcpLoadGenRef.current) return;
            setMcpData((prev) => mergeRuntimeHealth(prev, health));
          })
          .catch(() => {});
      } catch (e) {
        if (gen !== mcpLoadGenRef.current) return;
        setMcpError(e instanceof Error ? e.message : String(e));
      } finally {
        if (gen === mcpLoadGenRef.current) {
          if (kind === "initial") setMcpLoading(false);
          if (kind === "refresh") setMcpRefreshing(false);
        }
      }
    },
    [repositoryPath, normalizedProjectKey],
  );

  const reload = useCallback(async () => {
    await fetchMcpFromHost("silent");
  }, [fetchMcpFromHost]);

  const refreshMcp = useCallback(async () => {
    await fetchMcpFromHost("refresh");
  }, [fetchMcpFromHost]);

  useEffect(() => {
    if (!active) return;
    if (mcpCacheKey === normalizedProjectKey) return;
    void fetchMcpFromHost("initial");
  }, [active, normalizedProjectKey, mcpCacheKey, fetchMcpFromHost]);

  const visibleMcpData = useMemo(
    () => (omcInstalled ? mcpData : filterOmcFromMcpStatus(mcpData)),
    [mcpData, omcInstalled],
  );

  const mcpHasData = useMemo(() => MCP_SECTIONS.some(({ key }) => visibleMcpData[key].length > 0), [visibleMcpData]);
  const filteredMcpData = useMemo(() => filterMcpDataBySearch(visibleMcpData, listSearch), [visibleMcpData, listSearch]);
  const mcpHasFilteredData = useMemo(
    () => MCP_SECTIONS.some(({ key }) => filteredMcpData[key].length > 0),
    [filteredMcpData],
  );
  const mcpSectionsToRender = useMemo(() => {
    if (!listSearch.trim()) return MCP_SECTIONS;
    return MCP_SECTIONS.filter(({ key }) => filteredMcpData[key].length > 0);
  }, [filteredMcpData, listSearch]);
  const mcpCount = useMemo(
    () => MCP_SECTIONS.reduce((sum, { key }) => sum + visibleMcpData[key].length, 0),
    [visibleMcpData],
  );

  useEffect(() => {
    onCountChange?.(mcpCount);
  }, [mcpCount, onCountChange]);

  const handleDelete = useCallback(
    (item: ClaudeMcpItem) => {
      modal.confirm({
        title: `删除 MCP「${item.name}」？`,
        content: "将从对应配置文件中移除此条目（用户 / 本地 / 项目范围走 claude CLI；兼容项直接改 JSON）。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          try {
            await removeClaudeMcpServer({
              name: item.name,
              scope: item.scope,
              sourcePath: item.sourcePath,
              repositoryPath: repositoryPath ?? null,
              claudeJsonProjectKey: item.claudeJsonProjectKey,
            });
            message.success("已删除");
            setMcpData((prev) => removeMcpItemById(prev, item.id));
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        },
      });
    },
    [message, modal, repositoryPath],
  );

  const handleToggleEnabled = useCallback(
    async (item: ClaudeMcpItem, enabled: boolean) => {
      setMcpData((prev) => patchMcpItemEnabledById(prev, item.id, enabled));
      try {
        await setClaudeMcpServerEnabled({
          name: item.name,
          scope: item.scope,
          sourcePath: item.sourcePath,
          enabled,
          repositoryPath: repositoryPath ?? null,
          claudeJsonProjectKey: item.claudeJsonProjectKey,
        });
        message.success(enabled ? "已启用" : "已禁用");
      } catch (e) {
        setMcpData((prev) => patchMcpItemEnabledById(prev, item.id, !enabled));
        message.error(e instanceof Error ? e.message : String(e));
      }
    },
    [message, repositoryPath],
  );

  return {
    mcpData,
    setMcpData,
    mcpLoading,
    mcpRefreshing,
    mcpError,
    mcpHasData,
    filteredMcpData,
    mcpHasFilteredData,
    mcpSectionsToRender,
    mcpCount,
    fetchMcpFromHost,
    refreshMcp,
    reload,
    handleDelete,
    handleToggleEnabled,
  };
}
