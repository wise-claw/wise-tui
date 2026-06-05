import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Empty, Input, Modal, Select, Spin, Tag, Typography, message } from "antd";
import {
  gitCheckoutRevision,
  gitCherryPick,
  gitDeleteTag,
  gitGraph,
  gitListBranches,
  gitRevert,
} from "../../services/git";
import type { GitBranchEntry, GitGraphCommit } from "../../types";
import { GraphCreateBranchDialog, GraphCreateTagDialog, GraphResetDialog } from "./GraphCommitActionDialogs";
import { GraphComparePanel } from "./GraphComparePanel";
import { GraphCommitDetail } from "./GraphCommitDetail";
import { GraphCommitRow } from "./GraphCommitRow";
import { GraphSvgLayer } from "./GraphSvgLayer";
import { buildGitGraphBranchOptions, collectGitGraphAuthors } from "./gitGraphFilters";
import {
  computeGraphVirtualRange,
  isGraphEdgeVisible,
  shouldVirtualizeGraphRows,
} from "./graphVirtualRange";
import type { GitPanelOpenFileOptions } from "./types";
import {
  GIT_GRAPH_ROW_HEIGHT_PX,
  resolveGitGraphDisplayWidthPx,
  resolveGitGraphLaneWidthPx,
  buildGitGraphRenderArtifacts,
  computeGitGraphLayout,
  gitGraphLaneColor,
} from "./gitGraphLayout";

const { Text } = Typography;
const SCROLL_LOAD_THRESHOLD_PX = 56;
const INITIAL_LIMIT = 80;
const LOAD_MORE_LIMIT = 60;
const SEARCH_DEBOUNCE_MS = 300;

interface GraphModeProps {
  repositoryPath: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onRepositoryRefresh?: () => void;
}

export function GraphMode({
  repositoryPath,
  onOpenFile,
  onRepositoryRefresh,
}: GraphModeProps) {
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [createBranchSha, setCreateBranchSha] = useState<string | null>(null);
  const [createTagSha, setCreateTagSha] = useState<string | null>(null);
  const [resetSha, setResetSha] = useState<string | null>(null);
  const [compareBaseSha, setCompareBaseSha] = useState<string | null>(null);
  const [compareHeadSha, setCompareHeadSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [upstream, setUpstream] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 48 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRafRef = useRef<number | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const commitsRef = useRef<GitGraphCommit[]>([]);
  const branchFilterRef = useRef<string | null>(branchFilter);
  const authorFilterRef = useRef<string | null>(authorFilter);
  const searchQueryRef = useRef<string>(debouncedSearchQuery);
  commitsRef.current = commits;
  branchFilterRef.current = branchFilter;
  authorFilterRef.current = authorFilter;
  searchQueryRef.current = debouncedSearchQuery;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const reloadBranches = useCallback(() => {
    void gitListBranches(repositoryPath).then(setBranches).catch(() => setBranches([]));
  }, [repositoryPath]);

  useEffect(() => {
    let cancelled = false;
    void gitListBranches(repositoryPath)
      .then((items) => {
        if (!cancelled) {
          setBranches(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryPath]);

  const loadGraph = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append ?? false;
      if (loadInFlightRef.current) {
        await loadInFlightRef.current;
        return;
      }

      const run = (async () => {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        try {
          const skip = append ? commitsRef.current.length : 0;
          const limit = append ? LOAD_MORE_LIMIT : INITIAL_LIMIT;
          const response = await gitGraph(
            repositoryPath,
            limit,
            skip,
            branchFilterRef.current,
            searchQueryRef.current,
            authorFilterRef.current,
          );
          setAhead(response.ahead);
          setBehind(response.behind);
          setUpstream(response.upstream);
          setHasMore(response.hasMore);
          setError(null);
          setCommits((prev) => (append ? [...prev, ...response.commits] : response.commits));
        } catch (e) {
          const errMessage = e instanceof Error ? e.message : String(e);
          if (!append) {
            setCommits([]);
          }
          setError(errMessage);
        } finally {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      })();

      loadInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (loadInFlightRef.current === run) {
          loadInFlightRef.current = null;
        }
      }
    },
    [repositoryPath],
  );

  useEffect(() => {
    setCommits([]);
    setHasMore(false);
    setError(null);
    setSelectedSha(null);
    void loadGraph();
  }, [loadGraph, branchFilter, authorFilter, debouncedSearchQuery]);

  const layout = useMemo(() => computeGitGraphLayout(commits), [commits]);
  const graphLaneWidthPx = resolveGitGraphLaneWidthPx(layout.laneColumns);
  const graphWidth = resolveGitGraphDisplayWidthPx(layout.laneColumns);
  const graphHeight = layout.rows.length * GIT_GRAPH_ROW_HEIGHT_PX;
  const virtualizeRows = shouldVirtualizeGraphRows(commits.length);

  const renderArtifacts = useMemo(
    () => buildGitGraphRenderArtifacts(layout, graphLaneWidthPx),
    [graphLaneWidthPx, layout],
  );

  const shaToRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    commits.forEach((commit, rowIndex) => {
      map.set(commit.sha, rowIndex);
    });
    return map;
  }, [commits]);

  const rowRefBySha = useMemo(() => {
    const map = new Map<string, (element: HTMLDivElement | null) => void>();
    for (const commit of commits) {
      const sha = commit.sha;
      map.set(sha, (element) => {
        if (element) {
          rowRefs.current.set(sha, element);
        } else {
          rowRefs.current.delete(sha);
        }
      });
    }
    return map;
  }, [commits]);

  const updateVisibleRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || commits.length === 0 || !shouldVirtualizeGraphRows(commits.length)) {
      return;
    }
    const range = computeGraphVirtualRange(
      el.scrollTop,
      el.clientHeight,
      commits.length,
      GIT_GRAPH_ROW_HEIGHT_PX,
    );
    setVisibleRange((previous) =>
      previous.start === range.start && previous.end === range.end ? previous : range,
    );
  }, [commits.length]);

  useLayoutEffect(() => {
    updateVisibleRange();
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const resizeObserver = new ResizeObserver(() => updateVisibleRange());
    resizeObserver.observe(el);
    const onScroll = () => {
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateVisibleRange();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resizeObserver.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [updateVisibleRange, commits.length, graphHeight]);

  const visibleGraph = useMemo(() => {
    if (!virtualizeRows) {
      const allRowIndices = commits.map((_, rowIndex) => rowIndex);
      return {
        rowIndices: allRowIndices,
        edges: renderArtifacts.edges,
        nodes: renderArtifacts.nodes,
      };
    }

    const range = visibleRange;
    const rowIndexSet = new Set<number>();
    for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
      rowIndexSet.add(rowIndex);
    }
    if (selectedSha) {
      const selectedRowIndex = shaToRowIndex.get(selectedSha);
      if (selectedRowIndex !== undefined) {
        rowIndexSet.add(selectedRowIndex);
      }
    }
    const rowIndices = [...rowIndexSet].sort((left, right) => left - right);
    const rowIndexLookup = rowIndexSet;

    return {
      rowIndices,
      edges: renderArtifacts.edges.filter((edge) => isGraphEdgeVisible(edge, range)),
      nodes: renderArtifacts.nodes.filter(
        (node) => rowIndexLookup.has(node.rowIndex),
      ),
    };
  }, [commits, renderArtifacts.edges, renderArtifacts.nodes, selectedSha, shaToRowIndex, virtualizeRows, visibleRange]);

  const branchOptions = useMemo(() => buildGitGraphBranchOptions(branches), [branches]);

  const authorOptions = useMemo(() => {
    const authors = collectGitGraphAuthors(commits);
    return [
      { label: "全部作者", value: "" },
      ...authors.map((author) => ({ label: author, value: author })),
    ];
  }, [commits]);

  const refreshAfterGitMutation = useCallback(() => {
    onRepositoryRefresh?.();
    reloadBranches();
    void loadGraph();
  }, [loadGraph, onRepositoryRefresh, reloadBranches]);

  const handleCheckout = useCallback(
    async (revision: string) => {
      try {
        await gitCheckoutRevision(repositoryPath, revision);
        message.success("已切换版本");
        onRepositoryRefresh?.();
        setSelectedSha(null);
        refreshAfterGitMutation();
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        message.error(`检出失败：${errMessage}`);
        throw e;
      }
    },
    [refreshAfterGitMutation, repositoryPath],
  );

  const handleCherryPick = useCallback(
    (sha: string) => {
      Modal.confirm({
        title: "Cherry-pick 此提交？",
        content: `将把 ${sha.slice(0, 7)} 应用到当前分支 HEAD。`,
        okText: "Cherry-pick",
        cancelText: "取消",
        onOk: async () => {
          try {
            await gitCherryPick(repositoryPath, sha);
            message.success("Cherry-pick 完成");
            refreshAfterGitMutation();
          } catch (e) {
            const errMessage = e instanceof Error ? e.message : String(e);
            message.error(`Cherry-pick 失败：${errMessage}`);
            throw e;
          }
        },
      });
    },
    [refreshAfterGitMutation, repositoryPath],
  );

  const handleRevert = useCallback(
    (sha: string) => {
      Modal.confirm({
        title: "Revert 此提交？",
        content: `将创建一个新提交来撤销 ${sha.slice(0, 7)} 的变更。`,
        okText: "Revert",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await gitRevert(repositoryPath, sha);
            message.success("Revert 完成");
            refreshAfterGitMutation();
          } catch (e) {
            const errMessage = e instanceof Error ? e.message : String(e);
            message.error(`Revert 失败：${errMessage}`);
            throw e;
          }
        },
      });
    },
    [refreshAfterGitMutation, repositoryPath],
  );

  const handleCreateBranchSuccess = useCallback(() => {
    message.success("分支已创建并检出");
    refreshAfterGitMutation();
  }, [refreshAfterGitMutation]);

  const handleResetSuccess = useCallback(() => {
    message.success("Reset 完成");
    setSelectedSha(null);
    refreshAfterGitMutation();
  }, [refreshAfterGitMutation]);

  const handleCreateTagSuccess = useCallback(() => {
    message.success("标签已创建");
    refreshAfterGitMutation();
  }, [refreshAfterGitMutation]);

  const handleSetCompareBase = useCallback((sha: string) => {
    setCompareBaseSha(sha);
    setCompareHeadSha(null);
    message.success(`已设 ${sha.slice(0, 7)} 为对比基准`);
  }, []);

  const handleCompareWithBase = useCallback((sha: string) => {
    if (!compareBaseSha) {
      message.warning("请先设置对比基准");
      return;
    }
    setCompareHeadSha(sha);
    setSelectedSha(null);
  }, [compareBaseSha]);

  const handleCompareWithHead = useCallback((sha: string) => {
    setCompareBaseSha(sha);
    setCompareHeadSha("HEAD");
    setSelectedSha(null);
  }, []);

  const handleSwapCompare = useCallback(() => {
    if (!compareBaseSha || !compareHeadSha) {
      return;
    }
    setCompareBaseSha(compareHeadSha);
    setCompareHeadSha(compareBaseSha);
  }, [compareBaseSha, compareHeadSha]);

  const scrollCommitIntoView = useCallback((sha: string) => {
    const rowIndex = commitsRef.current.findIndex((commit) => commit.sha === sha);
    if (rowIndex < 0) {
      return;
    }
    const el = scrollRef.current;
    if (el) {
      const rowTop = rowIndex * GIT_GRAPH_ROW_HEIGHT_PX;
      const rowBottom = rowTop + GIT_GRAPH_ROW_HEIGHT_PX;
      if (rowTop < el.scrollTop) {
        el.scrollTop = rowTop;
      } else if (rowBottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = rowBottom - el.clientHeight;
      }
    }
    rowRefs.current.get(sha)?.scrollIntoView({ block: "nearest" });
  }, []);

  const selectCommit = useCallback(
    (sha: string, options?: { closeCompare?: boolean }) => {
      scrollRef.current?.focus();
      if (options?.closeCompare !== false) {
        setCompareHeadSha(null);
      }
      setSelectedSha(sha);
      scrollCommitIntoView(sha);
    },
    [scrollCommitIntoView],
  );

  const handleSelectCommitFromBlame = useCallback(
    (sha: string) => {
      selectCommit(sha);
    },
    [selectCommit],
  );

  const moveCommitSelection = useCallback(
    (delta: number) => {
      if (commits.length === 0) {
        return;
      }
      const currentIndex = selectedSha ? commits.findIndex((commit) => commit.sha === selectedSha) : -1;
      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = delta > 0 ? 0 : commits.length - 1;
      } else {
        nextIndex = currentIndex + delta;
        if (nextIndex < 0 || nextIndex >= commits.length) {
          return;
        }
      }
      const nextSha = commits[nextIndex]?.sha;
      if (!nextSha) {
        return;
      }
      selectCommit(nextSha, { closeCompare: false });
      if (nextIndex >= commits.length - 5 && hasMore && !loadingMore) {
        void loadGraph({ append: true });
      }
    },
    [commits, hasMore, loadGraph, loadingMore, selectCommit, selectedSha],
  );

  const handleGraphKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCommitSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCommitSelection(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (compareHeadSha && selectedSha) {
          setCompareHeadSha(null);
          return;
        }
        if (!selectedSha && commits.length > 0) {
          selectCommit(commits[0].sha);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (compareHeadSha) {
          setCompareHeadSha(null);
          return;
        }
        if (selectedSha) {
          setSelectedSha(null);
        }
      }
    },
    [compareHeadSha, commits, moveCommitSelection, selectCommit, selectedSha],
  );

  useEffect(() => {
    if (!selectedSha) {
      return;
    }
    scrollCommitIntoView(selectedSha);
  }, [scrollCommitIntoView, selectedSha]);

  const handleDeleteTag = useCallback(
    (tagName: string) => {
      Modal.confirm({
        title: `删除标签 ${tagName}？`,
        content: "仅删除本地标签，不会删除远程 tag。",
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await gitDeleteTag(repositoryPath, tagName);
            message.success(`已删除标签 ${tagName}`);
            refreshAfterGitMutation();
          } catch (e) {
            const errMessage = e instanceof Error ? e.message : String(e);
            message.error(`删除标签失败：${errMessage}`);
            throw e;
          }
        },
      });
    },
    [refreshAfterGitMutation, repositoryPath],
  );

  const copySha = useCallback(async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      message.success("已复制 SHA");
    } catch {
      message.error("复制失败");
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !hasMore) {
      return;
    }
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_LOAD_THRESHOLD_PX;
    if (nearBottom) {
      void loadGraph({ append: true });
    }
  }, [hasMore, loadGraph, loading, loadingMore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !hasMore) {
      return;
    }
    if (el.scrollHeight <= el.clientHeight + SCROLL_LOAD_THRESHOLD_PX) {
      void loadGraph({ append: true });
    }
  }, [commits.length, hasMore, loadGraph, loading, loadingMore]);

  if (loading && commits.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Spin size="small" description="加载提交图..." />
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <Empty
        description={`提交图加载失败：${error}`}
        style={{ padding: "24px 0" }}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const emptyDescription =
    debouncedSearchQuery || authorFilter || branchFilter ? "无匹配的提交" : "暂无提交记录";

  return (
    <div className="git-graph-mode">
      <div className="git-graph-toolbar">
        <Select
          size="small"
          className="git-graph-branch-filter"
          classNames={{ popup: { root: "git-graph-select-dropdown" } }}
          value={branchFilter ?? ""}
          options={branchOptions}
          popupMatchSelectWidth={false}
          showSearch
          optionFilterProp="label"
          placeholder="全部分支"
          onChange={(value) => setBranchFilter(value ? String(value) : null)}
        />
        <Select
          size="small"
          className="git-graph-author-filter"
          classNames={{ popup: { root: "git-graph-select-dropdown" } }}
          value={authorFilter ?? ""}
          options={authorOptions}
          popupMatchSelectWidth={false}
          onChange={(value) => setAuthorFilter(value ? String(value) : null)}
        />
        <Input
          size="small"
          allowClear
          className="git-graph-search"
          placeholder="搜索提交、作者、SHA、分支"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {compareBaseSha ? (
          <Tag
            closable
            className="git-graph-compare-base-tag"
            onClose={() => {
              setCompareBaseSha(null);
              setCompareHeadSha(null);
            }}
          >
            对比基准 {compareBaseSha.slice(0, 7)}
          </Tag>
        ) : null}
      </div>

      {upstream && (ahead > 0 || behind > 0) ? (
        <div className="git-log-sync-info">
          <div className="git-log-sync-stats">
            <Tag color="default" className="git-log-upstream-tag">
              {upstream}
            </Tag>
            {ahead > 0 ? <span className="git-log-stat git-log-stat--ahead">↑{ahead}</span> : null}
            {behind > 0 ? <span className="git-log-stat git-log-stat--behind">↓{behind}</span> : null}
          </div>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="git-graph-mode-scroll"
        tabIndex={0}
        aria-label="提交历史列表，方向键选择提交，Enter 打开详情，Esc 关闭详情"
        onScroll={handleScroll}
        onKeyDown={handleGraphKeyDown}
        onMouseDown={() => scrollRef.current?.focus()}
      >
        {commits.length === 0 ? (
          <Empty
            description={emptyDescription}
            style={{ padding: "24px 0" }}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
        <div
          className={`git-graph-table${virtualizeRows ? " git-graph-table--virtualized" : ""}`}
          style={virtualizeRows ? { height: graphHeight } : undefined}
        >
          <div className="git-graph-table__graph" style={{ width: graphWidth }}>
            <GraphSvgLayer
              width={graphWidth}
              height={graphHeight}
              edges={visibleGraph.edges}
              nodes={visibleGraph.nodes}
              selectedSha={selectedSha}
              onSelectCommit={selectCommit}
            />
          </div>

          <div className="git-graph-table__rows">
            {visibleGraph.rowIndices.map((rowIndex) => {
              const commit = commits[rowIndex];
              if (!commit) {
                return null;
              }
              return (
                <GraphCommitRow
                  key={commit.sha}
                  commit={commit}
                  laneColor={gitGraphLaneColor(layout.rows[rowIndex]?.lane ?? 0)}
                  rowHeight={GIT_GRAPH_ROW_HEIGHT_PX}
                  virtualized={virtualizeRows}
                  virtualTop={virtualizeRows ? rowIndex * GIT_GRAPH_ROW_HEIGHT_PX : undefined}
                  selected={selectedSha === commit.sha}
                  rowRef={rowRefBySha.get(commit.sha)}
                  onSelectCommit={selectCommit}
                  onCheckout={(revision) => void handleCheckout(revision)}
                  onCherryPick={handleCherryPick}
                  onRevert={handleRevert}
                  onCreateBranch={setCreateBranchSha}
                  onCreateTag={setCreateTagSha}
                  onReset={setResetSha}
                  onSetCompareBase={handleSetCompareBase}
                  onCompareWithBase={handleCompareWithBase}
                  onCompareWithHead={handleCompareWithHead}
                  canCompareWithBase={Boolean(compareBaseSha) && compareBaseSha !== commit.sha}
                  canCompareWithHead={!commit.refs.some((ref) => ref.isHead)}
                  onDeleteTag={handleDeleteTag}
                  onCopySha={copySha}
                />
              );
            })}
          </div>
        </div>
        )}

        {hasMore || loadingMore ? (
          <div className="git-log-list-footer">
            {loadingMore ? (
              <Spin size="small" />
            ) : (
              <Text type="secondary" style={{ fontSize: 10 }}>
                已显示 {commits.length} 条{hasMore ? " · 继续向下滚动加载" : ""}
              </Text>
            )}
          </div>
        ) : null}
      </div>

      {compareBaseSha && compareHeadSha ? (
        <GraphComparePanel
          repositoryPath={repositoryPath}
          baseSha={compareBaseSha}
          headSha={compareHeadSha}
          onClose={() => setCompareHeadSha(null)}
          onSwap={handleSwapCompare}
          onOpenFile={onOpenFile}
          onSelectCommit={handleSelectCommitFromBlame}
        />
      ) : selectedSha ? (
        <GraphCommitDetail
          repositoryPath={repositoryPath}
          sha={selectedSha}
          onClose={() => setSelectedSha(null)}
          onOpenFile={onOpenFile}
          onCheckout={handleCheckout}
          onCherryPick={() => handleCherryPick(selectedSha)}
          onRevert={() => handleRevert(selectedSha)}
          onCreateBranch={() => setCreateBranchSha(selectedSha)}
          onCreateTag={() => setCreateTagSha(selectedSha)}
          onReset={() => setResetSha(selectedSha)}
          onCompareWithHead={
            commits.some((commit) => commit.sha === selectedSha && !commit.refs.some((ref) => ref.isHead))
              ? () => handleCompareWithHead(selectedSha)
              : undefined
          }
          onSetCompareBase={() => handleSetCompareBase(selectedSha)}
          onSelectCommit={handleSelectCommitFromBlame}
        />
      ) : null}

      <GraphCreateBranchDialog
        open={createBranchSha !== null}
        sha={createBranchSha ?? ""}
        repositoryPath={repositoryPath}
        onClose={() => setCreateBranchSha(null)}
        onSuccess={handleCreateBranchSuccess}
      />
      <GraphResetDialog
        open={resetSha !== null}
        sha={resetSha ?? ""}
        repositoryPath={repositoryPath}
        onClose={() => setResetSha(null)}
        onSuccess={handleResetSuccess}
      />
      <GraphCreateTagDialog
        open={createTagSha !== null}
        sha={createTagSha ?? ""}
        repositoryPath={repositoryPath}
        onClose={() => setCreateTagSha(null)}
        onSuccess={handleCreateTagSuccess}
      />
    </div>
  );
}
