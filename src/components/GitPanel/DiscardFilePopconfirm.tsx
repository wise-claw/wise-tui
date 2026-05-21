import type { ReactNode } from "react";
import { Popconfirm } from "antd";

interface DiscardFilePopconfirmProps {
  filePath: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}

export function DiscardFilePopconfirm({
  filePath,
  onConfirm,
  children,
}: DiscardFilePopconfirmProps) {
  return (
    <Popconfirm
      classNames={{ root: "app-git-discard-popconfirm" }}
      title="确认放弃更改？"
      description={(
        <div className="app-git-discard-popconfirm__body">
          <span className="app-git-discard-popconfirm__hint">未暂存修改将永久丢失。</span>
          <code className="app-git-discard-popconfirm__path">{filePath}</code>
        </div>
      )}
      okText="放弃"
      cancelText="取消"
      okButtonProps={{ danger: true, size: "small" }}
      cancelButtonProps={{ size: "small" }}
      placement="top"
      getPopupContainer={() => document.body}
      styles={{ container: { width: 228, maxWidth: "min(228px, 78vw)" } }}
      onConfirm={onConfirm}
    >
      {children}
    </Popconfirm>
  );
}
