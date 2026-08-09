import { Select, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchRepositoryFiles } from "../../services/repositoryFiles";
import { normalizeScheduledTaskScriptFilePath } from "../../utils/scheduledTaskScript";

interface Props {
  repositoryPath: string;
  value?: string;
  onChange?: (next: string) => void;
  disabled?: boolean;
}

/**
 * 仓库相对脚本路径选择：可搜索文件名，仅列出非目录条目。
 */
export function ScheduledTaskScriptFileSelect({
  repositoryPath,
  value,
  onChange,
  disabled,
}: Props) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const requestSeqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const runSearch = useCallback(
    async (query: string) => {
      const root = repositoryPath.trim();
      if (!root) {
        setOptions([]);
        return;
      }
      const seq = ++requestSeqRef.current;
      setSearching(true);
      try {
        const entries = await searchRepositoryFiles(root, query.trim());
        if (seq !== requestSeqRef.current) return;
        const files = entries
          .filter((entry) => !entry.isDir)
          .map((entry) => {
            const path = normalizeScheduledTaskScriptFilePath(entry.path) ?? entry.path.replace(/^\/+/, "");
            return { value: path, label: path };
          })
          .filter((item) => item.value);
        const current = normalizeScheduledTaskScriptFilePath(value);
        if (current && !files.some((item) => item.value === current)) {
          files.unshift({ value: current, label: current });
        }
        setOptions(files.slice(0, 80));
      } catch {
        if (seq === requestSeqRef.current) setOptions([]);
      } finally {
        if (seq === requestSeqRef.current) setSearching(false);
      }
    },
    [repositoryPath, value],
  );

  useEffect(() => {
    void runSearch("");
  }, [runSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <Select
      showSearch
      allowClear
      disabled={disabled || !repositoryPath.trim()}
      value={value?.trim() ? value : undefined}
      placeholder="搜索并选择仓库内脚本文件"
      options={options}
      filterOption={false}
      onSearch={(query) => {
        if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
          void runSearch(query);
        }, 220);
      }}
      onChange={(next) => onChange?.(typeof next === "string" ? next : "")}
      notFoundContent={searching ? <Spin size="small" /> : "未找到文件"}
      optionFilterProp="label"
    />
  );
}
