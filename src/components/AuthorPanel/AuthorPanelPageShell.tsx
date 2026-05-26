import type { ReactNode } from "react";
import "./AuthorPanelPageShell.css";

export interface AuthorPanelPageShellProps {
  id?: string;
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** 筛选 pill 较多时置于副标题下方整行，避免与副标题横排挤压 */
  toolbarLayout?: "subrow" | "stacked";
  children?: ReactNode;
  className?: string;
}

export function AuthorPanelPageShell({
  id,
  icon,
  title,
  subtitle,
  actions,
  toolbar,
  toolbarLayout = "subrow",
  children,
  className,
}: AuthorPanelPageShellProps) {
  const rootClass = [
    "author-panel-page",
    toolbar && toolbarLayout === "stacked" ? "author-panel-page--stacked-toolbar" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} id={id}>
      <header className="author-panel-page__head">
        <div className="author-panel-page__head-row">
          <div className="author-panel-page__title-wrap">
            {icon ? (
              <span className="author-panel-page__icon" aria-hidden>
                {icon}
              </span>
            ) : null}
            <h1 className="author-panel-page__title">{title}</h1>
          </div>
          {actions ? <div className="author-panel-page__actions">{actions}</div> : null}
        </div>
        {subtitle || toolbar ? (
          <div className="author-panel-page__subrow">
            {subtitle ? <p className="author-panel-page__subtitle">{subtitle}</p> : null}
            {toolbar ? <div className="author-panel-page__toolbar">{toolbar}</div> : null}
          </div>
        ) : null}
      </header>
      {children ? <section className="author-panel-page__body">{children}</section> : null}
    </div>
  );
}

export interface AuthorPanelHubTabProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}

export function AuthorPanelHubTab({ active, label, count, onClick }: AuthorPanelHubTabProps) {
  return (
    <button
      type="button"
      className={`author-panel-hub-tab${active ? " author-panel-hub-tab--active" : ""}`}
      onClick={onClick}
    >
      {label}
      <span className="author-panel-hub-tab__count">{count}</span>
    </button>
  );
}

export function AuthorPanelHubTabs({
  children,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <div className="author-panel-hub-tabs" role="tablist" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function AuthorPanelListShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const cls = ["author-panel-page__list-shell", className].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
}

export function AuthorPanelEmptyShell({ children }: { children: ReactNode }) {
  return <div className="author-panel-page__empty-shell">{children}</div>;
}
