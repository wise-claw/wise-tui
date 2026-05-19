import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  children: ReactNode;
}

export function SettingsPageWrapper({ title, children }: Props) {
  return (
    <div className="settings-page-wrapper">
      {title != null ? <h1 className="settings-page-wrapper__title">{title}</h1> : null}
      <div className="settings-page-wrapper__body">{children}</div>
    </div>
  );
}
