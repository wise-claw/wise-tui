import { Button, Dropdown, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { OpenAppTarget } from "../../types";
import { canOpenAppTarget, openWorkspaceWithOpenAppTarget } from "../../services/openWorkspaceWithPreference";
import {
  ensureMacTerminalsDetected,
  isMacPlatform,
  isTerminalOpenAppId,
} from "../../services/macosTerminal";
import { setTerminalAppPreference } from "../../services/terminalAppPreference";
import { mergeMacOpenAppTargets } from "../../utils/macosOpenAppTargets";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "./constants";
import { getKnownOpenAppIcon } from "./openAppIcons";
import { setOpenAppPreference } from "../../services/openAppPreference";
import "./index.css";

// ── Types ──

type OpenTarget = {
  id: string;
  label: string;
  icon: string;
  target: OpenAppTarget;
};

interface Props {
  path: string;
  openTargets?: OpenAppTarget[];
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
}

// ── Helpers ──

function canOpenTarget(target: OpenTarget): boolean {
  return canOpenAppTarget(target.target);
}

export function OpenAppMenu({
  path,
  openTargets,
  selectedOpenAppId,
  onSelectOpenAppId,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [macMergedTargets, setMacMergedTargets] = useState<readonly OpenAppTarget[] | null>(null);

  useEffect(() => {
    if (!isMacPlatform()) return;
    let cancelled = false;
    void ensureMacTerminalsDetected().then((detected) => {
      if (cancelled || detected.length === 0) return;
      setMacMergedTargets(mergeMacOpenAppTargets(detected));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableTargets =
    openTargets && openTargets.length > 0
      ? openTargets
      : macMergedTargets && macMergedTargets.length > 0
        ? macMergedTargets
        : DEFAULT_OPEN_APP_TARGETS;

  const resolvedOpenAppId =
    availableTargets.find((t) => t.id === selectedOpenAppId)?.id ??
    availableTargets[0]?.id ??
    DEFAULT_OPEN_APP_ID;

  const resolvedTargets: OpenTarget[] = useMemo(
    () =>
      availableTargets.map((target) => ({
        id: target.id,
        label: target.label,
        icon: getKnownOpenAppIcon(target.id) ?? "",
        target,
      })),
    [availableTargets],
  );

  const selectedTarget =
    resolvedTargets.find((t) => t.id === resolvedOpenAppId) ??
    resolvedTargets[0] ??
    null;

  const canOpen = selectedTarget ? canOpenTarget(selectedTarget) : false;
  const openLabel = canOpen
    ? `在 ${selectedTarget.label} 中打开`
    : selectedTarget?.target.kind === "command"
      ? "在设置中配置命令"
      : "在设置中配置应用名称";

  async function handleOpen() {
    if (!selectedTarget || !canOpen) return;
    await openWorkspaceWithOpenAppTarget(path, selectedTarget.target);
  }

  async function handleSelect(target: OpenTarget) {
    if (!canOpenTarget(target)) return;
    onSelectOpenAppId(target.id);
    void setOpenAppPreference(target.id);
    if (isTerminalOpenAppId(target.id)) {
      void setTerminalAppPreference(target.id);
    }
    setDropdownOpen(false);
    await openWorkspaceWithOpenAppTarget(path, target.target);
  }

  const menuItems = resolvedTargets.map((target) => ({
    key: target.id,
    label: (
      <div className="app-open-app-option">
        <img
          className="app-open-app-option-icon"
          src={target.icon}
          alt=""
          aria-hidden
        />
        <span>{target.label}</span>
      </div>
    ),
    disabled: !canOpenTarget(target),
  }));

  return (
    <div className="app-open-app-menu">
      <Tooltip title={openLabel} mouseEnterDelay={0.3}>
        <Button
          type="text"
          size="small"
          className="app-open-app-btn"
          onClick={handleOpen}
          disabled={!canOpen}
        >
          {selectedTarget && (
            <img
              className="app-open-app-btn-icon"
              src={selectedTarget.icon}
              alt=""
              aria-hidden
            />
          )}
          <span>{selectedTarget?.label ?? "Open"}</span>
        </Button>
      </Tooltip>
      <Dropdown
        menu={{ items: menuItems, onClick: ({ key }) => {
          const target = resolvedTargets.find((t) => t.id === key);
          if (target) handleSelect(target);
        } }}
        placement="bottomLeft"
        trigger={["click"]}
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        rootClassName="app-open-app-dropdown"
      >
        <Button
          type="text"
          size="small"
          className="app-open-app-chevron"
          aria-label="选择编辑器"
        >
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      </Dropdown>
    </div>
  );
}
