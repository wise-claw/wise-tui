import { Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
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
  summaryMeta?: string | null;
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
  summaryMeta = null,
  headActions,
  children,
  trailing,
}: InspectorCollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useInspectorSectionCollapsed(sectionId);
  const bemClass = resolvePanelClassName(className, panelClassName);

  return (
    <section
      className={`${className}${collapsed ? ` ${bemClass}--section-collapsed` : ""}`}
      aria-label={ariaLabel}
    >
      {collapsed ? (
        <div className="app-inspector-collapsible-section__collapsed-row">
          <button
            type="button"
            className="app-inspector-collapsible-section__collapsed-main"
            aria-expanded={false}
            aria-label={`展开${title}`}
            onClick={() => setCollapsed(false)}
          >
            <span className="app-inspector-collapsible-section__expand" aria-hidden>
              <ExpandIcon expanded={false} />
            </span>
            <span className="app-inspector-collapsible-section__collapsed-title">{title}</span>
            {summaryMeta ? (
              <span className="app-inspector-collapsible-section__collapsed-meta">{summaryMeta}</span>
            ) : null}
          </button>
        </div>
      ) : (
        <>
          <header className={`${bemClass}__head app-inspector-collapsible-section__head`}>
            <Typography.Text strong className={`${bemClass}__title`}>
              {title}
            </Typography.Text>
            <div className="app-inspector-collapsible-section__head-actions">
              {headActions}
              <Tooltip title={`收起${title}`} mouseEnterDelay={0.35}>
                <button
                  type="button"
                  className="app-inspector-collapsible-section__collapse-btn"
                  aria-label={`收起${title}`}
                  onClick={() => setCollapsed(true)}
                >
                  <ExpandIcon expanded />
                </button>
              </Tooltip>
            </div>
          </header>
          {children}
        </>
      )}
      {trailing}
    </section>
  );
}
