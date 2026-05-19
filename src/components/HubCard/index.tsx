import type { ReactNode } from "react";
import "./index.css";
import "../ExtensionsPanel/index.css";

/** Hash an arbitrary string into one of six AionUi-style avatar colors. */
const AVATAR_PALETTE = [
  "#165DFF", "#00B42A", "#722ED1", "#F5319D", "#F77234", "#14C9C9",
] as const;

export function avatarColorFor(name: string): string {
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

interface HubCardProps {
  icon: ReactNode;
  title: ReactNode;
  pill?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  id?: string;
}

export function HubCard({ icon, title, pill, actions, meta, children, id }: HubCardProps) {
  return (
    <section className="app-hub" id={id}>
      <div className="app-hub__head">
        <div className="app-hub__title-row">
          <div className="app-hub__title">
            <span className="app-hub__title-icon">{icon}</span>
            {title}
            {pill ? <span className="app-hub__title-pill">{pill}</span> : null}
          </div>
          {actions ? <div className="app-hub__actions">{actions}</div> : null}
        </div>
        {meta ? <div className="app-hub__meta">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

interface HubItemProps {
  avatarText: string;
  avatarColor?: string;
  title: ReactNode;
  tags?: ReactNode;
  author?: ReactNode;
  description?: ReactNode;
  path?: ReactNode;
  actions?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export function HubItem({
  avatarText,
  avatarColor,
  title,
  tags,
  author,
  description,
  path,
  actions,
  active,
  onClick,
}: HubItemProps) {
  const color = avatarColor ?? avatarColorFor(avatarText);
  return (
    <div
      className={`app-hub__item${active ? " app-hub__item--active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="app-hub__avatar" style={{ background: color }} aria-hidden>
        {avatarText.slice(0, 1)}
      </span>
      <div className="app-hub__item-body">
        <div className="app-hub__item-title-row">
          <span className="app-hub__item-title">{title}</span>
          {tags}
          {author ? <span className="app-hub__item-author">{author}</span> : null}
        </div>
        {description ? <p className="app-hub__item-desc">{description}</p> : null}
        {path ? <p className="app-hub__item-path">{path}</p> : null}
      </div>
      {actions ? <div className="app-hub__item-actions">{actions}</div> : null}
    </div>
  );
}

type TagTone = "default" | "primary" | "success" | "warning" | "danger" | "purple";

interface HubTagProps {
  tone?: TagTone;
  mono?: boolean;
  children: ReactNode;
}

export function HubTag({ tone = "default", mono, children }: HubTagProps) {
  const cls = `app-hub__tag app-hub__tag--${tone}${mono ? " app-hub__tag--mono" : ""}`;
  return <span className={cls}>{children}</span>;
}

type DotTone = "on" | "warn" | "off";

export function HubDot({ tone = "on" }: { tone?: DotTone }) {
  return <span className={`app-hub__dot app-hub__dot--${tone}`} aria-hidden />;
}

interface HubEmptyProps {
  title: string;
  hint?: ReactNode;
}

export function HubEmpty({ title, hint }: HubEmptyProps) {
  return (
    <div className="app-hub__empty">
      <strong>{title}</strong>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

interface HubItemsProps {
  children: ReactNode;
}

export function HubItems({ children }: HubItemsProps) {
  return <div className="app-hub__items">{children}</div>;
}
