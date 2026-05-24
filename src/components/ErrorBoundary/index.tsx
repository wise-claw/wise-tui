import { Component, type ErrorInfo, type ReactNode } from "react";
import "./index.css";

interface Props {
  children: ReactNode;
  type?: "global" | "local";
  fallbackTitle?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an exception:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
    if (this.props.onRetry) {
      try {
        this.props.onRetry();
      } catch (err) {
        console.error("Error during ErrorBoundary retry callback:", err);
      }
    }
  };

  private handleCopyLog = () => {
    const { error, errorInfo } = this.state;
    const systemInfo = `OS: Mac
Time: ${new Date().toISOString()}
URL: ${window.location.href}
UserAgent: ${navigator.userAgent}`;

    const logText = `=== WISE WORKBENCH ERROR REPORT ===
${systemInfo}

Error: ${error?.message || "Unknown error"}
Stack: ${error?.stack || "No stack trace available"}
Component Stack: ${errorInfo?.componentStack || "No component stack available"}`;

    navigator.clipboard.writeText(logText)
      .then(() => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
      })
      .catch((err) => {
        console.error("Failed to copy error logs to clipboard:", err);
      });
  };

  public render() {
    const { hasError, error, copied } = this.state;
    const { type = "local", fallbackTitle, children } = this.props;

    if (!hasError) {
      return children;
    }

    if (type === "global") {
      return (
        <div className="wise-global-error-boundary">
          <div className="wise-global-error-card">
            <div className="wise-error-header">
              <div className="wise-error-glowing-circle">
                <span className="wise-error-icon">⚠️</span>
              </div>
              <h1 className="wise-error-title">应用遇到未预期的运行故障</h1>
              <p className="wise-error-subtitle">
                为了防止数据损坏或丢失，Wise 已自动隔离了此故障。
                您可以尝试重新挂载应用或复制错误日志寻求协助。
              </p>
            </div>

            <div className="wise-error-actions">
              <button className="wise-btn-primary" onClick={this.handleReload}>
                重新加载应用
              </button>
              <button className="wise-btn-secondary" onClick={this.handleCopyLog}>
                {copied ? "已复制日志 ✓" : "复制错误日志"}
              </button>
              <button className="wise-btn-tertiary" onClick={this.handleReset}>
                尝试重置恢复
              </button>
            </div>

            {error && (
              <details className="wise-error-details-collapsed">
                <summary className="wise-error-details-summary">查看详细报错代码追踪</summary>
                <div className="wise-error-tracebox">
                  <div className="wise-error-trace-meta">
                    <span>{error.name}: {error.message}</span>
                  </div>
                  <pre className="wise-error-pre-code">
                    <code>{error.stack || "无可用堆栈追踪信息"}</code>
                  </pre>
                </div>
              </details>
            )}
            
            {copied && <div className="wise-copied-toast">日志已成功复制到剪贴板</div>}
          </div>
        </div>
      );
    }

    // Local modular card fallback
    return (
      <div className="wise-local-error-boundary">
        <div className="wise-local-error-card">
          <div className="wise-local-error-main">
            <span className="wise-local-error-icon">⚠️</span>
            <div className="wise-local-error-body">
              <h4 className="wise-local-error-title">{fallbackTitle || "此模块加载失败"}</h4>
              <p className="wise-local-error-message">
                {error?.message || "发生了未知的组件渲染错误"}
              </p>
            </div>
            <div className="wise-local-error-actions">
              <button className="wise-local-btn-retry" onClick={this.handleReset}>
                重试板块
              </button>
              <button className="wise-local-btn-copy" onClick={this.handleCopyLog} title="复制日志">
                {copied ? "已复制 ✓" : "复制日志"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
