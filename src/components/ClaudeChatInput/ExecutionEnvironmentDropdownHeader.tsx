interface Props {
  onOpenConfig?: () => void;
  /** 是否展示副标题（合并弹窗中仅保留标题行以节省高度） */
  showSubtitle?: boolean;
}

export function ExecutionEnvironmentDropdownHeader({
  onOpenConfig,
  showSubtitle = true,
}: Props) {
  return (
    <div className="app-claude-connection-kind-dropdown-header app-claude-connection-kind-dropdown-header--with-action">
      <div className="app-claude-connection-kind-dropdown-header__text">
        <span className="app-claude-connection-kind-dropdown-header-title">执行环境</span>
        {showSubtitle ? (
          <span className="app-claude-connection-kind-dropdown-header-subtitle">
            选择后台 AI 代码执行的 CLI 引擎
          </span>
        ) : null}
      </div>
      {onOpenConfig ? (
        <button
          type="button"
          className="app-claude-connection-kind-dropdown-header-config-btn"
          aria-label="打开工作台配置 · 执行环境"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenConfig();
          }}
        >
          配置
        </button>
      ) : null}
    </div>
  );
}
