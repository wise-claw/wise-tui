import { CloseOutlined, DownOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Popover, Spin, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import { listRepositoryExplorerChildren } from "../../services/repositoryFiles";
import {
  buildRepositoryScriptFileTreeNodes,
  patchRepositoryScriptFileTreeChildren,
  repositoryScriptFileTreeNodeTitle,
  type RepositoryScriptFileTreeNode,
} from "../../utils/repositoryScriptFileTree";
import { normalizeScheduledTaskScriptFilePath } from "../../utils/scheduledTaskScript";
import { ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "../GitPanel/explorerTreeChrome";
import "./ScheduledTaskScriptFileSelect.css";

interface Props {
  repositoryPath: string;
  value?: string;
  onChange?: (next: string) => void;
  disabled?: boolean;
}

function toAntTreeData(nodes: RepositoryScriptFileTreeNode[]): DataNode[] {
  return nodes.map((node) => {
    const name = repositoryScriptFileTreeNodeTitle(node.value) || node.value;
    return {
      key: node.value,
      title: name,
      isLeaf: node.isLeaf,
      selectable: node.selectable,
      icon: (props: { expanded?: boolean }) =>
        node.isLeaf ? (
          <ExplorerTreeFileIcon fileName={name} className="app-script-file-select__icon" />
        ) : (
          <ExplorerTreeFolderIcon
            name={name}
            expanded={Boolean(props.expanded)}
            className="app-script-file-select__icon"
          />
        ),
      children: node.children ? toAntTreeData(node.children) : undefined,
    };
  });
}

/**
 * 仓库目录树选择执行文件：交互对齐左栏仓库目录选择（按钮 + 树），仅文件可选。
 */
export function ScheduledTaskScriptFileSelect({
  repositoryPath,
  value,
  onChange,
  disabled,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [treeData, setTreeData] = useState<RepositoryScriptFileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const noRepository = !repositoryPath.trim();
  const isDisabled = Boolean(disabled || noRepository);

  const loadChildren = useCallback(async (parentDir: string): Promise<RepositoryScriptFileTreeNode[]> => {
    const root = repositoryPath.trim();
    if (!root) return [];
    const entries = await listRepositoryExplorerChildren(root, parentDir);
    return buildRepositoryScriptFileTreeNodes(entries);
  }, [repositoryPath]);

  useEffect(() => {
    setPickerOpen(false);
    const root = repositoryPath.trim();
    if (!root) {
      setTreeData([]);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    void loadChildren("")
      .then((nodes) => {
        if (seq !== requestSeqRef.current) return;
        setTreeData(nodes);
      })
      .catch(() => {
        if (seq === requestSeqRef.current) setTreeData([]);
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
  }, [loadChildren, repositoryPath]);

  const onLoadData = useCallback(
    async (node: { key?: Key; children?: readonly unknown[] }) => {
      if (node.children && node.children.length > 0) return;
      const parentDir = typeof node.key === "string" ? node.key : "";
      if (!parentDir) return;
      try {
        const children = await loadChildren(parentDir);
        setTreeData((prev) => patchRepositoryScriptFileTreeChildren(prev, parentDir, children));
      } catch {
        setTreeData((prev) => patchRepositoryScriptFileTreeChildren(prev, parentDir, []));
      }
    },
    [loadChildren],
  );

  const antTreeData = useMemo(() => toAntTreeData(treeData), [treeData]);
  const selectedPath = normalizeScheduledTaskScriptFilePath(value) ?? "";

  const picker = (
    <div className="app-script-file-select__panel">
      {loading && antTreeData.length === 0 ? (
        <div className="app-script-file-select__empty">
          <Spin size="small" />
        </div>
      ) : antTreeData.length === 0 ? (
        <div className="app-script-file-select__empty">暂无文件</div>
      ) : (
        <Tree
          className="app-script-file-select__tree"
          blockNode
          showLine
          showIcon
          expandAction="click"
          loadData={onLoadData}
          treeData={antTreeData}
          selectedKeys={selectedPath ? [selectedPath] : []}
          onSelect={(keys, info) => {
            if (info.node.isLeaf === false || info.node.selectable === false) return;
            const raw = String(keys[0] ?? "");
            const normalized = normalizeScheduledTaskScriptFilePath(raw);
            if (!normalized) return;
            onChange?.(normalized);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );

  return (
    <Popover
      open={isDisabled ? false : pickerOpen}
      onOpenChange={(next) => {
        if (isDisabled) return;
        setPickerOpen(next);
      }}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      overlayClassName="app-script-file-select__popover"
      getPopupContainer={() => document.body}
      content={picker}
    >
      <button
        type="button"
        className="app-script-file-select__trigger"
        disabled={isDisabled}
        title={selectedPath || undefined}
        aria-label={selectedPath ? `执行文件：${selectedPath}` : "选择仓库内文件"}
        aria-expanded={pickerOpen}
      >
        <FolderOpenOutlined className="app-script-file-select__trigger-icon" aria-hidden />
        <span
          className={
            selectedPath
              ? "app-script-file-select__trigger-text"
              : "app-script-file-select__trigger-text app-script-file-select__trigger-text--placeholder"
          }
        >
          {selectedPath || (noRepository ? "请先选择仓库" : "选择仓库内文件")}
        </span>
        {selectedPath && !isDisabled ? (
          <span
            className="app-script-file-select__clear"
            role="button"
            aria-label="清除所选文件"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange?.("");
            }}
          >
            <CloseOutlined />
          </span>
        ) : (
          <DownOutlined className="app-script-file-select__caret" aria-hidden />
        )}
      </button>
    </Popover>
  );
}
