import {
  AppstoreAddOutlined,
  FileTextOutlined,
  LeftOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Modal, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MilkdownViewer } from "../MilkdownViewer";
import { SettingsViewModeProvider } from "../SettingsView";
import {
  getExtensionSettingsTabs,
  readExtensionSettingsTabBody,
} from "../../services/extensions";
import type { ResolvedSettingsTab } from "../../types/extension";
import "./index.css";

export type AppSettingsModalBuiltinTab =
  | "extensions"
  | "claudeConfigDir"
  | "assistants"
  | "mcp"
  | "agents"
  | "shortcuts"
  | "sandbox";

/** A tab key may be a builtin id, or `ext-<extension>-<tab>` from a contribution. */
export type AppSettingsModalTab = AppSettingsModalBuiltinTab | string;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 每次 `open` 变为 `true` 时若传入，则选中对应 Tab */
  initialTab?: AppSettingsModalTab;
}

interface NavTabSpec {
  key: AppSettingsModalTab;
  label: string;
  icon: ReactNode;
  /** When true the tab body is rendered from an extension markdown body. */
  extension?: ResolvedSettingsTab;
}

const BUILTIN_TABS: NavTabSpec[] = [
  { key: "extensions", label: "扩展设置", icon: <AppstoreAddOutlined /> },
];

/**
 * Merge builtin tabs with extension-contributed tabs honouring
 * `position.anchor` + `position.placement`. Tabs without a position are
 * appended at the end (preserving load order). Mirrors AionUi's
 * `mergeSettingsTabs` algorithm.
 */
function mergeSettingsTabs(builtin: NavTabSpec[], ext: ResolvedSettingsTab[]): NavTabSpec[] {
  const merged = [...builtin];
  // First pass: tabs anchored to a known id.
  const orphans: ResolvedSettingsTab[] = [];
  for (const t of ext) {
    if (!t.anchor || !t.placement) {
      orphans.push(t);
      continue;
    }
    const idx = merged.findIndex((b) => b.key === t.anchor);
    if (idx === -1) {
      orphans.push(t);
      continue;
    }
    const insertAt = t.placement === "before" ? idx : idx + 1;
    merged.splice(insertAt, 0, toNavSpec(t));
  }
  // Second pass: orphans appended in original order.
  for (const t of orphans) {
    merged.push(toNavSpec(t));
  }
  return merged;
}

function toNavSpec(t: ResolvedSettingsTab): NavTabSpec {
  return {
    key: t.id,
    label: t.label,
    icon: <FileTextOutlined />,
    extension: t,
  };
}

export function AppSettingsModal({ open, onClose, initialTab = "extensions" }: Props) {
  const [tab, setTab] = useState<AppSettingsModalTab>(initialTab);
  const [extTabs, setExtTabs] = useState<ResolvedSettingsTab[]>([]);
  const [bodyById, setBodyById] = useState<Record<string, string>>({});
  const [bodyLoading, setBodyLoading] = useState(false);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Load extension-contributed tabs whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    void getExtensionSettingsTabs()
      .then(setExtTabs)
      .catch(() => setExtTabs([]));
  }, [open]);

  const tabs = useMemo(() => mergeSettingsTabs(BUILTIN_TABS, extTabs), [extTabs]);

  // Lazy-load the body for the active extension tab.
  useEffect(() => {
    const active = tabs.find((t) => t.key === tab);
    if (!active?.extension) return;
    if (bodyById[active.extension.id] != null) return;
    setBodyLoading(true);
    void readExtensionSettingsTabBody(active.extension.id)
      .then((body) => {
        setBodyById((prev) => ({ ...prev, [active.extension!.id]: body }));
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setBodyById((prev) => ({ ...prev, [active.extension!.id]: `> 加载失败：${message}` }));
      })
      .finally(() => setBodyLoading(false));
  }, [tab, tabs, bodyById]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const activeSpec = tabs.find((t) => t.key === tab);
  const resolvedActiveSpec = activeSpec ?? tabs[0];
  const activeTabKey = resolvedActiveSpec?.key;
  const activeExt = resolvedActiveSpec?.extension;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      closable={false}
      mask={{ closable: true }}
      keyboard
      centered={false}
      width="100%"
      rootClassName="app-settings-modal-root"
      className="app-settings-modal"
      styles={{
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <SettingsViewModeProvider value="modal">
        <div className="app-settings-modal__shell">
          <div className="app-settings-modal__topbar">
            <Button type="text" className="app-settings-modal__back" icon={<LeftOutlined />} onClick={handleClose}>
              返回应用
            </Button>
            <span className="app-settings-modal__topbar-title">工作台配置兼容入口</span>
          </div>
          <div className="app-settings-modal__split">
            <nav className="app-settings-modal__nav" aria-label="工作台配置分类">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`app-settings-modal__nav-item${activeTabKey === item.key ? " app-settings-modal__nav-item--active" : ""}`}
                  onClick={() => setTab(item.key)}
                  title={item.extension ? `via ${item.extension.extension}` : undefined}
                >
                  <span className="app-settings-modal__nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="app-settings-modal__nav-label">{item.label}</span>
                  {item.extension ? (
                    <span
                      className="app-settings-modal__nav-extbadge"
                      aria-hidden
                      title={`扩展：${item.extension.extension}`}
                    >
                      ext
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
            <main className="app-settings-modal__main">
              <TypographyTitle activeSpec={resolvedActiveSpec} />
              <div className="app-settings-modal__scroll">
                {!activeExt ? (
                  <Alert
                    type="info"
                    showIcon
                    className="app-settings-modal__compat-alert"
                    message="内置设置已集中到左侧齿轮的工作台配置。"
                    description="这里仅保留扩展贡献设置页和历史入口兼容，不再复制引擎环境、助手模板、MCP、执行引擎、快捷键或沙箱配置。"
                  />
                ) : null}
                {activeExt ? (
                  <div className="app-settings-modal__pane app-settings-modal__pane--wide">
                    {bodyLoading && bodyById[activeExt.id] == null ? (
                      <div style={{ padding: 24, textAlign: "center" }}>
                        <Spin size="small" />
                      </div>
                    ) : (
                      <ExtensionTabBody
                        extension={activeExt.extension}
                        body={bodyById[activeExt.id] ?? ""}
                      />
                    )}
                  </div>
                ) : (
                  <BuiltinSettingsMoved extTabCount={extTabs.length} />
                )}
              </div>
            </main>
          </div>
        </div>
      </SettingsViewModeProvider>
    </Modal>
  );
}

function TypographyTitle({ activeSpec }: { activeSpec: NavTabSpec | undefined }) {
  const title = activeSpec?.label ?? "扩展设置";
  return <h1 className="app-settings-modal__title">{title}</h1>;
}

export function BuiltinSettingsMoved({ extTabCount }: { extTabCount: number }) {
  return (
    <div className="app-settings-modal__moved">
      <h2>工作台配置是唯一内置设置入口</h2>
      <p>
        旧设置弹窗只承载扩展贡献的设置页。请从左侧齿轮进入工作台配置，按工作台、生态、运行设置三组管理内置能力。
      </p>
      <div className="app-settings-modal__moved-grid" aria-label="内置设置迁移说明">
        <span>引擎环境 → 工作台配置 / 运行设置 / 引擎环境</span>
        <span>助手模板 → 工作台配置 / 生态 / 助手模板</span>
        <span>MCP 工具 → 工作台配置 / 生态 / MCP 工具</span>
        <span>执行引擎 → 工作台配置 / 生态 / 执行引擎</span>
        <span>默认配置 → 工作台配置 / 运行设置 / 默认配置</span>
        <span>快捷键 → 工作台配置 / 运行设置 / 快捷键</span>
        <span>Claude 沙箱 → 工作台配置 / 运行设置 / Claude 沙箱</span>
      </div>
      {extTabCount === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无扩展贡献的设置页" />
      ) : null}
    </div>
  );
}

interface ExtensionTabBodyProps {
  extension: string;
  body: string;
}

function ExtensionTabBody({ extension, body }: ExtensionTabBodyProps) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "var(--ant-color-text-tertiary)",
          marginBottom: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        来自扩展 · {extension}
      </div>
      <MilkdownViewer text={body} />
    </div>
  );
}
