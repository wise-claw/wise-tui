import { Fragment, type CSSProperties, type Key, type ReactNode } from "react";
import { Empty, Spin } from "antd";

type ListSize = "small" | "default" | "large";

interface AppListProps<T> {
  className?: string;
  size?: ListSize;
  bordered?: boolean;
  split?: boolean;
  loading?: boolean;
  dataSource?: readonly T[];
  rowKey?: keyof T | ((item: T) => Key);
  locale?: { emptyText?: ReactNode };
  renderItem?: (item: T, index: number) => ReactNode;
}

interface AppListItemProps {
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  actions?: ReactNode[];
  children?: ReactNode;
}

interface AppListItemMetaProps {
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  avatar?: ReactNode;
}

function listRootClassName(
  className: string | undefined,
  size: ListSize,
  bordered: boolean,
  split: boolean,
  loading: boolean,
): string {
  const parts = ["ant-list"];
  if (size === "small") parts.push("ant-list-sm");
  if (size === "large") parts.push("ant-list-lg");
  if (bordered) parts.push("ant-list-bordered");
  if (split) parts.push("ant-list-split");
  if (loading) parts.push("ant-list-loading");
  if (className) parts.push(className);
  return parts.join(" ");
}

function resolveRowKey<T>(item: T, index: number, rowKey?: keyof T | ((item: T) => Key)): Key {
  if (typeof rowKey === "function") return rowKey(item);
  if (rowKey) return (item[rowKey] as Key) ?? index;
  const keyed = item as { key?: Key };
  return keyed.key ?? index;
}

function AppListItemMeta({ className, title, description, avatar }: AppListItemMetaProps) {
  const rootClass = ["ant-list-item-meta", className].filter(Boolean).join(" ");
  return (
    <div className={rootClass}>
      {avatar ? <div className="ant-list-item-meta-avatar">{avatar}</div> : null}
      {title || description ? (
        <div className="ant-list-item-meta-content">
          {title ? <h4 className="ant-list-item-meta-title">{title}</h4> : null}
          {description ? <div className="ant-list-item-meta-description">{description}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function AppListItem({ className, style, onClick, actions, children }: AppListItemProps) {
  const actionsContent =
    actions && actions.length > 0 ? (
      <ul className="ant-list-item-action">
        {actions.map((action, index) => (
          <li key={index}>
            {action}
            {index !== actions.length - 1 ? <em className="ant-list-item-action-split" /> : null}
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <li
      className={["ant-list-item", className].filter(Boolean).join(" ")}
      style={style}
      onClick={onClick}
    >
      {children}
      {actionsContent}
    </li>
  );
}

function AppList<T>({
  className,
  size = "default",
  bordered = false,
  split = true,
  loading = false,
  dataSource = [],
  rowKey,
  locale,
  renderItem,
}: AppListProps<T>) {
  const rootClass = listRootClassName(className, size, bordered, split, loading);
  const items = dataSource.map((item, index) => (
    <Fragment key={resolveRowKey(item, index, rowKey)}>{renderItem?.(item, index)}</Fragment>
  ));

  const body =
    dataSource.length === 0 && !loading ? (
      <div className="ant-list-empty-text">{locale?.emptyText ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}</div>
    ) : (
      <ul className="ant-list-items">{items}</ul>
    );

  return (
    <div className={rootClass}>
      <Spin spinning={loading}>{body}</Spin>
    </div>
  );
}

AppList.Item = AppListItem;
AppListItem.Meta = AppListItemMeta;

/** Ant Design 6 弃用 `List`；项目内统一用此组件，保留 `ant-list*` 类名以兼容现有样式。 */
export { AppList as List };

export type { AppListItemProps, AppListItemMetaProps, AppListProps, ListSize };
