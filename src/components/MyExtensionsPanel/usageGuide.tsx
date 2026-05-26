import { Tooltip, Typography } from "antd";

export function MyExtensionsUsageTooltipContent() {
  return (
    <div className="app-my-extensions-usage-tip">
      <div className="app-my-extensions-usage-tip__title">使用流程</div>
      <ol className="app-my-extensions-usage-tip__list">
        <li>
          扩展库存放在 <Typography.Text code>~/.wise/extension-library</Typography.Text>
          ，可通过其它入口写入或打开「扩展库目录」手动添加。
        </li>
        <li>左侧选择条目，右侧编辑快照文件并「保存内容」。</li>
        <li>多文件条目可在类型行切换当前编辑的文件。</li>
      </ol>
    </div>
  );
}

/** 流程说明图标；hover 展示使用流程。 */
export function MyExtensionsUsageHelpIcon({ className }: { className?: string }) {
  return (
    <Tooltip
      title={<MyExtensionsUsageTooltipContent />}
      placement="bottomLeft"
      classNames={{ root: "app-my-extensions-usage-tip-overlay" }}
      mouseEnterDelay={0.25}
      mouseLeaveDelay={0.15}
    >
      <span
        className={`app-my-extensions-usage-help-icon ${className ?? ""}`.trim()}
        role="img"
        aria-label="我的扩展使用流程"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M5.2 4.8h5.6M5.2 8h3.4M5.2 11.2h5.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </Tooltip>
  );
}
