import { Typography } from "antd";
import { HoverHint } from "../shared/HoverHint";
import type { MouseEvent, ReactNode } from "react";
import { ExpandIcon } from "../LeftSidebar/SidebarIcons";
import { useInspectorSectionCollapsed } from "./useInspectorSectionCollapsed";
import type { InspectorSectionId } from "./inspectorStorage";
import "./InspectorCollapsibleSection.css";

export interface InspectorCollapsibleSectionProps {
  sectionId: InspectorSectionId;
  className: string;
  /** BEM block prefix for `__head` / `__title`; defaults to the first class in `className`. */
  panelClassName?: string;
  ariaLabel: string;
  title: string;
  headActions?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}

function resolvePanelClassName(className: string, panelClassName?: string): string {
  const explicit = panelClassName?.trim();
  if (explicit) return explicit;
  return className.split(/\s+/).find(Boolean) ?? className;
}

export function InspectorCollapsibleSection({
  sectionId,
  className,
  panelClassName,
  ariaLabel,
  title,
  headActions,
  children,
  trailing,
}: InspectorCollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useInspectorSectionCollapsed(sectionId);
  const bemClass = resolvePanelClassName(className, panelClassName);

  const handleHeadClick = () => {
    setCollapsed(!collapsed);
  };

  const handleHeadActionsClick = (e: MouseEvent) => {
    // 阻止操作按钮所在区域的点击冒泡到 header，避免误触发收起/展开
    e.stopPropagation();
  };

  return (
    <section
      className={`${className}${collapsed ? ` ${bemClass}--section-collapsed` : ""}`}
      aria-label={ariaLabel}
    >
      <header
        className={`${bemClass}__head app-inspector-collapsible-section__head`}
        onClick={handleHeadClick}
      >
        <Typography.Text strong className={`${bemClass}__title`}>
          {title}
        </Typography.Text>
        <div
          className="app-inspector-collapsible-section__head-actions"
          onClick={handleHeadActionsClick}
        >
          {headActions}
          <HoverHint
            title={collapsed ? `展开${title}` : `收起${title}`}

          >
            <button
              type="button"
              className="app-inspector-collapsible-section__collapse-btn"
              aria-expanded={!collapsed}
              aria-label={collapsed ? `展开${title}` : `收起${title}`}
              onClick={() => setCollapsed(!collapsed)}
            >
              <ExpandIcon expanded={!collapsed} />
            </button>
          </HoverHint>
        </div>
      </header>
      {!collapsed ? children : null}
      {trailing}
    </section>
  );
}
