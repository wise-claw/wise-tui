import { CodeOutlined, FolderOpenOutlined, GlobalOutlined, LineChartOutlined } from "@ant-design/icons";
import { UsagePillGroup } from "./UsagePillGroup";

export type UsageScope = "global" | "repository";
export type UsageView = "tokens" | "lineEdits";

interface ClaudeUsageToolbarProps {
  view: UsageView;
  onViewChange: (view: UsageView) => void;
  scope: UsageScope;
  onScopeChange: (scope: UsageScope) => void;
  showScope: boolean;
}

const VIEW_OPTIONS = [
  {
    value: "tokens" as const,
    label: "Token 用量",
    icon: <LineChartOutlined />,
  },
  {
    value: "lineEdits" as const,
    label: "代码编辑量",
    icon: <CodeOutlined />,
  },
];

const SCOPE_OPTIONS = [
  {
    value: "global" as const,
    label: "全局",
    icon: <GlobalOutlined />,
  },
  {
    value: "repository" as const,
    label: "本仓库",
    icon: <FolderOpenOutlined />,
  },
];

export function ClaudeUsageToolbar({
  view,
  onViewChange,
  scope,
  onScopeChange,
  showScope,
}: ClaudeUsageToolbarProps) {
  return (
    <div className="app-cc-usage-toolbar">
      <UsagePillGroup
        value={view}
        options={VIEW_OPTIONS}
        onChange={onViewChange}
        ariaLabel="用量视图"
      />
      {showScope ? (
        <UsagePillGroup
          value={scope}
          options={SCOPE_OPTIONS}
          onChange={onScopeChange}
          size="sm"
          ariaLabel="统计范围"
          className="app-cc-usage-toolbar__scope"
        />
      ) : null}
    </div>
  );
}
