import { AutoComplete } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { SlashCatalogSnapshot } from "../../services/slashCatalogCache";
import { loadSlashCatalog } from "../../services/slashCatalogCache";
import {
  buildDefaultInstructionSelectOptionGroups,
  ensureDefaultInstructionOption,
  flattenDefaultInstructionSelectOptions,
} from "../../utils/defaultInstructionSelectOptions";
import { normalizeComposerDefaultInstruction } from "../../utils/composerDefaultInstruction";
import "./ComposerDefaultInstructionField.css";

function formatDefaultInstructionOptionLabel(option: {
  label: string;
  description?: string;
}): string {
  const cmd = option.label.trim();
  const desc = option.description?.trim();
  if (!desc) return cmd;
  const clipped = desc.length > 40 ? `${desc.slice(0, 40)}…` : desc;
  return `${cmd} — ${clipped}`;
}

function filterDefaultInstructionOption(input: string, option?: { value?: string; label?: unknown }): boolean {
  const query = input.trim().toLowerCase().replace(/^\//, "");
  if (!query) return true;
  const value = String(option?.value ?? "").toLowerCase().replace(/^\//, "");
  const labelText =
    typeof option?.label === "string"
      ? option.label
      : value;
  return value.includes(query) || labelText.toLowerCase().includes(query);
}

export function ComposerDefaultInstructionField({
  value,
  disabled,
  loading,
  repositoryPath,
  placeholder = "选择或输入 /autopilot",
  onChange,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  loading?: boolean;
  repositoryPath?: string | null;
  placeholder?: string;
  onChange: (next: string) => void;
  onCommit?: (next: string) => void | Promise<void>;
}) {
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSnapshot, setCatalogSnapshot] = useState<SlashCatalogSnapshot | null>(null);
  const [optionGroups, setOptionGroups] = useState<
    ReturnType<typeof buildDefaultInstructionSelectOptionGroups>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void loadSlashCatalog(repositoryPath?.trim() || null)
      .then((snapshot) => {
        if (cancelled) return;
        setOptionGroups(buildDefaultInstructionSelectOptionGroups(snapshot));
        setCatalogSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) {
          setOptionGroups([]);
          setCatalogSnapshot(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryPath]);

  const groupsWithCurrent = useMemo(
    () =>
      ensureDefaultInstructionOption(
        optionGroups,
        value,
        catalogSnapshot ?? undefined,
      ),
    [optionGroups, value, catalogSnapshot],
  );

  const autoCompleteOptions = useMemo(
    () =>
      groupsWithCurrent.map((group) => ({
        label: group.label,
        options: group.options.map((option) => ({
          value: option.value,
          label: formatDefaultInstructionOptionLabel(option),
        })),
      })),
    [groupsWithCurrent],
  );

  const flatOptions = useMemo(
    () => flattenDefaultInstructionSelectOptions(groupsWithCurrent),
    [groupsWithCurrent],
  );

  const handleCommit = (nextRaw: string) => {
    const normalized = normalizeComposerDefaultInstruction(nextRaw);
    onChange(normalized);
    void onCommit?.(normalized);
  };

  return (
    <AutoComplete
      className="app-composer-default-instruction-field"
      value={value}
      disabled={disabled || loading || catalogLoading}
      options={autoCompleteOptions}
      placeholder={placeholder}
      allowClear
      popupMatchSelectWidth
      classNames={{ popup: { root: "app-composer-default-instruction-field__popup" } }}
      filterOption={filterDefaultInstructionOption}
      onChange={(next) => onChange(next)}
      onSelect={(next) => handleCommit(String(next))}
      onBlur={() => {
        if (value.trim()) {
          void handleCommit(value);
        } else {
          void onCommit?.("");
        }
      }}
      notFoundContent={
        flatOptions.length === 0 && !catalogLoading ? "暂无可选指令，可直接输入 /命令" : undefined
      }
    />
  );
}
