import {
  DeleteOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOutlined,
  FileOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Input, Menu, Modal, Space, Spin, Tree } from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createExtensionLibrarySnapshotDirectory,
  createExtensionLibrarySnapshotFile,
  deleteExtensionLibrarySnapshotEntry,
} from "../../services/myExtensions";
import type { SnapshotTreeNode } from "../../types/myExtension";
import {
  findSnapshotNode,
  joinSnapshotRelative,
  parentDirForSnapshotKey,
  resolveTreeFocusKey,
  SNAPSHOT_ROOT_KEY,
} from "./snapshotTreePaths";

const META_JSON_KEY = "meta.json";

function collectExpandableKeys(nodes: SnapshotTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: SnapshotTreeNode[]) => {
    for (const node of items) {
      if (!node.isLeaf) {
        keys.push(node.key);
        if (node.children?.length) walk(node.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

function treeNodeTitle(label: string) {
  return (
    <span className="app-my-extensions-panel__snapshot-tree-title" title={label}>
      {label}
    </span>
  );
}

function toAntTreeData(nodes: SnapshotTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.key,
    title: treeNodeTitle(node.title),
    isLeaf: node.isLeaf,
    icon: node.isLeaf ? <FileOutlined /> : <FolderOutlined />,
    children: node.isLeaf ? undefined : toAntTreeData(node.children ?? []),
  }));
}

function wrapWithSnapshotRoot(nodes: SnapshotTreeNode[]): DataNode[] {
  if (nodes.length === 0) return [];
  return [
    {
      key: SNAPSHOT_ROOT_KEY,
      title: treeNodeTitle("根目录"),
      isLeaf: false,
      selectable: false,
      icon: <FolderOutlined />,
      children: toAntTreeData(nodes),
    },
  ];
}

export interface ExtensionSnapshotTreeProps {
  libraryItemId: string;
  tree: SnapshotTreeNode[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (relativePath: string) => void;
  onRefresh: () => Promise<void>;
}

export function ExtensionSnapshotTree({
  libraryItemId,
  tree,
  loading,
  selectedKey,
  onSelect,
  onRefresh,
}: ExtensionSnapshotTreeProps) {
  const { message, modal } = App.useApp();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  /** 目录树当前焦点（文件或文件夹），用于新建/删除的目标目录 */
  const [treeFocusKey, setTreeFocusKey] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; key: string | null } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"file" | "directory">("file");
  const [createParent, setCreateParent] = useState("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  const treeData = useMemo(() => wrapWithSnapshotRoot(tree), [tree]);

  useEffect(() => {
    setExpandedKeys([SNAPSHOT_ROOT_KEY, ...collectExpandableKeys(tree)]);
  }, [tree]);

  useEffect(() => {
    if (selectedKey) {
      setTreeFocusKey(selectedKey);
    }
  }, [selectedKey]);

  const createTargetKey = resolveTreeFocusKey(treeFocusKey);

  const openCreate = useCallback(
    (kind: "file" | "directory", parentKey: string | null) => {
      setCreateKind(kind);
      setCreateParent(parentDirForSnapshotKey(tree, parentKey));
      setCreateName("");
      setCreateOpen(true);
      setCtx(null);
    },
    [tree],
  );

  const handleCreate = useCallback(async () => {
    const relativePath = joinSnapshotRelative(createParent, createName);
    if (!relativePath) {
      message.warning("请输入有效的名称（不含 / 或 ..）");
      return;
    }
    setCreating(true);
    try {
      if (createKind === "file") {
        await createExtensionLibrarySnapshotFile(libraryItemId, relativePath);
      } else {
        await createExtensionLibrarySnapshotDirectory(libraryItemId, relativePath);
      }
      setCreateOpen(false);
      await onRefresh();
      if (createKind === "file") {
        onSelect(relativePath);
        setTreeFocusKey(relativePath);
      } else {
        setTreeFocusKey(relativePath);
        setExpandedKeys((prev) =>
          prev.includes(relativePath) ? prev : [...prev, relativePath],
        );
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [createKind, createName, createParent, libraryItemId, message, onRefresh, onSelect]);

  const handleDelete = useCallback(
    (relativePath: string) => {
      if (relativePath === META_JSON_KEY) {
        message.warning("不能删除元数据文件 meta.json");
        return;
      }
      const node = findSnapshotNode(tree, relativePath);
      modal.confirm({
        title: "确认删除",
        content: node?.isLeaf
          ? `将永久删除文件「${relativePath}」。`
          : `将递归删除目录「${relativePath}」及其全部内容。`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          try {
            await deleteExtensionLibrarySnapshotEntry(libraryItemId, relativePath);
            if (selectedKey === relativePath || selectedKey?.startsWith(`${relativePath}/`)) {
              onSelect("");
            }
            await onRefresh();
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        },
      });
      setCtx(null);
    },
    [libraryItemId, message, modal, onRefresh, onSelect, selectedKey, tree],
  );

  const contextMenuItems = useMemo(() => {
    const targetKey = ctx?.key ?? null;
    const canDelete = targetKey !== null && targetKey !== META_JSON_KEY;
    return [
      {
        key: "new-file",
        label: "新建文件",
        icon: <FileAddOutlined />,
        onClick: () => openCreate("file", targetKey),
      },
      {
        key: "new-dir",
        label: "新建文件夹",
        icon: <FolderAddOutlined />,
        onClick: () => openCreate("directory", targetKey),
      },
      { type: "divider" as const },
      {
        key: "delete",
        label: "删除",
        icon: <DeleteOutlined />,
        danger: true,
        disabled: !canDelete,
        onClick: () => {
          if (targetKey) handleDelete(targetKey);
        },
      },
    ];
  }, [ctx?.key, handleDelete, openCreate]);

  return (
    <div className="app-my-extensions-panel__snapshot-tree">
      <div className="app-my-extensions-panel__snapshot-tree-toolbar">
        <Space size={2} wrap={false} className="app-my-extensions-panel__snapshot-tree-actions">
          <Button
            size="small"
            type="text"
            icon={<FileAddOutlined />}
            title="新建文件"
            onClick={() => openCreate("file", createTargetKey)}
          />
          <Button
            size="small"
            type="text"
            icon={<FolderAddOutlined />}
            title="新建文件夹"
            onClick={() => openCreate("directory", createTargetKey)}
          />
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            title="刷新目录"
            loading={loading}
            onClick={() => void onRefresh()}
          />
        </Space>
      </div>
      <div
        className="app-my-extensions-panel__snapshot-tree-body"
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY, key: createTargetKey });
        }}
      >
        {loading && tree.length === 0 ? (
          <div className="author-panel-page__loading">
            <Spin size="small" />
          </div>
        ) : tree.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="快照为空" />
        ) : (
          <Tree
            className="app-my-extensions-panel__snapshot-ant-tree"
            blockNode
            showIcon
            showLine={false}
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={treeFocusKey ? [treeFocusKey] : []}
            onExpand={(keys) => {
              const next = keys as string[];
              setExpandedKeys(
                next.includes(SNAPSHOT_ROOT_KEY) ? next : [SNAPSHOT_ROOT_KEY, ...next],
              );
            }}
            onSelect={(_, info) => {
              const node = info.node as EventDataNode<DataNode>;
              const key = String(node.key);
              if (key === SNAPSHOT_ROOT_KEY) {
                setTreeFocusKey(null);
                return;
              }
              setTreeFocusKey(key);
              if (node.isLeaf) {
                onSelect(key);
              }
            }}
            onRightClick={({ event, node }) => {
              event.preventDefault();
              const key = String(node.key);
              const ctxKey = resolveTreeFocusKey(key);
              setTreeFocusKey(ctxKey);
              if (node.isLeaf) {
                onSelect(key);
              }
              setCtx({ x: event.clientX, y: event.clientY, key: ctxKey });
            }}
          />
        )}
      </div>
      {ctx ? (
        <>
          <div
            className="app-my-extensions-panel__snapshot-ctx-backdrop"
            role="presentation"
            aria-hidden
            onMouseDown={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <Menu
            className="app-my-extensions-panel__snapshot-ctx-menu"
            style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 1050 }}
            selectable={false}
            items={contextMenuItems}
          />
        </>
      ) : null}
      <Modal
        title={createKind === "file" ? "新建文件" : "新建文件夹"}
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
        onOk={() => void handleCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        {createParent ? (
          <p className="app-my-extensions-panel__create-hint">
            位置：<code>{createParent}/</code>
          </p>
        ) : (
          <p className="app-my-extensions-panel__create-hint">位置：快照根目录</p>
        )}
        <Input
          placeholder={createKind === "file" ? "文件名，如 hooks.json" : "文件夹名"}
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onPressEnter={() => void handleCreate()}
          autoFocus
        />
      </Modal>
    </div>
  );
}
