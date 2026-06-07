import { DeleteOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, InputNumber, Popconfirm, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "../LeftSidebar/systemSessions";
import {
  getComposerImageGcConfig,
  runComposerImageGc,
  saveComposerImageGcConfig,
  type ComposerImageGcConfig,
} from "../../services/composerImageGc";
import {
  cleanupWiseDataCategories,
  listWiseDataCleanupCategories,
  openWiseHomeDir,
  WISE_IMAGE_CLEANUP_CATEGORY_IDS,
  type WiseDataCategoryUsage,
} from "../../services/wiseDataCleanup";
import "./index.css";

function buildDataCleanupNotes(config: ComposerImageGcConfig): string[] {
  const maxMbHint =
    config.maxMb > 0 ? `总量超过 ${config.maxMb} MB 时也会触发回收` : "未启用容量上限，仅按保留期回收";
  return [
    "清理范围仅限 ~/.wise 下的缓存目录，不会删除 wise.db、repositories.json、tabs.json 或扩展目录。",
    "Composer 图片包含主会话截图、粘贴与上传；PRD 粘贴图片来自需求编辑器。",
    `Wise 会自动回收无引用且超过 ${config.ttlDays} 天的 Composer 图片；${config.graceHours} 小时内的新附图不会被误删。${maxMbHint}。`,
    "「清理无引用图片」仅删除未被会话引用的过期缓存，不影响当前会话附图。",
    "清理 PRD 拆分快照后，进行中的拆分可能需重新物化；已发送会话中的附图 @ 引用可能失效。",
  ];
}

function formatUsageLine(item: WiseDataCategoryUsage): string {
  if (!item.exists || item.fileCount === 0) {
    return "暂无文件";
  }
  const base = `${item.fileCount} 个文件 · ${formatBytes(item.byteSize)}`;
  if (item.id !== "composer_images") {
    return base;
  }
  const referenced = item.referencedFileCount ?? 0;
  const gcEligible = item.gcEligibleFileCount ?? 0;
  const gcBytes = item.gcEligibleByteSize ?? 0;
  if (referenced === 0 && gcEligible === 0) {
    return base;
  }
  const parts = [base];
  if (referenced > 0) {
    parts.push(`引用中 ${referenced} 个`);
  }
  if (gcEligible > 0) {
    parts.push(`可安全清理 ${gcEligible} 个 · ${formatBytes(gcBytes)}`);
  }
  return parts.join(" · ");
}

/** 工作台「数据清理」：按类别清理 ~/.wise 缓存（含图片）。 */
export function DataCleanupPanel() {
  const { message } = App.useApp();
  const [categories, setCategories] = useState<WiseDataCategoryUsage[]>([]);
  const [gcConfig, setGcConfig] = useState<ComposerImageGcConfig | null>(null);
  const [gcConfigDraft, setGcConfigDraft] = useState<ComposerImageGcConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | "all-images" | "composer-gc" | "composer-config" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, config] = await Promise.all([
        listWiseDataCleanupCategories(),
        getComposerImageGcConfig(),
      ]);
      setCategories(cats);
      setGcConfig(config);
      setGcConfigDraft(config);
    } catch (err) {
      message.error(`读取数据占用失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runCleanup = useCallback(
    async (ids: string[], busyKey: string | "all-images") => {
      setBusyId(busyKey);
      try {
        const results = await cleanupWiseDataCategories(ids);
        const removed = results.reduce((sum, r) => sum + r.removedFiles, 0);
        if (removed === 0) {
          message.info("所选目录已为空，无需清理");
        }
        await refresh();
      } catch (err) {
        message.error(`清理失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [message, refresh],
  );

  const openWiseHome = useCallback(async () => {
    try {
      await openWiseHomeDir();
    } catch (err) {
      message.error(`打开目录失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [message]);

  const imageUsage = categories.filter((c) =>
    (WISE_IMAGE_CLEANUP_CATEGORY_IDS as readonly string[]).includes(c.id),
  );
  const imageBytes = imageUsage.reduce((sum, c) => sum + c.byteSize, 0);
  const imageFiles = imageUsage.reduce((sum, c) => sum + c.fileCount, 0);
  const composerCategory = categories.find((c) => c.id === "composer_images");
  const composerGcEligible = composerCategory?.gcEligibleFileCount ?? 0;
  const composerGcBytes = composerCategory?.gcEligibleByteSize ?? 0;

  const gcConfigDirty =
    gcConfig &&
    gcConfigDraft &&
    (gcConfig.ttlDays !== gcConfigDraft.ttlDays ||
      gcConfig.graceHours !== gcConfigDraft.graceHours ||
      gcConfig.maxMb !== gcConfigDraft.maxMb);

  const saveGcConfig = useCallback(async () => {
    if (!gcConfigDraft) return;
    setBusyId("composer-config");
    try {
      const saved = await saveComposerImageGcConfig(gcConfigDraft);
      setGcConfig(saved);
      setGcConfigDraft(saved);
      message.success("Composer 图片回收策略已保存");
      await refresh();
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }, [gcConfigDraft, message, refresh]);

  const runComposerGc = useCallback(async () => {
    setBusyId("composer-gc");
    try {
      const result = await runComposerImageGc();
      if (!result || result.removedFiles === 0) {
        message.info("当前没有可安全清理的无引用 Composer 图片");
      } else {
        message.success(
          `已清理 ${result.removedFiles} 个无引用图片，释放 ${formatBytes(result.freedBytes)}`,
        );
      }
      await refresh();
    } catch (err) {
      message.error(`清理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }, [message, refresh]);

  return (
    <div className="app-data-cleanup-panel">
      <section className="app-data-cleanup-panel__main" aria-label="数据清理">
        <div className="app-data-cleanup-panel__toolbar">
          <Typography.Text type="secondary">
            清理 ~/.wise 下的缓存文件，不影响工作区、仓库注册表与 wise.db
          </Typography.Text>
          <Space size={4} wrap>
            <Button
              type="link"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => void openWiseHome()}
            >
              打开 ~/.wise
            </Button>
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void refresh()}
            >
              刷新占用
            </Button>
          </Space>
        </div>

        <div className="app-data-cleanup-panel__bulk">
          <Typography.Text type="secondary">
            图片缓存合计：
            {imageFiles > 0 ? `${imageFiles} 个文件 · ${formatBytes(imageBytes)}` : "暂无"}
          </Typography.Text>
          <Popconfirm
            title="清理全部图片缓存？"
            description="将删除 Composer 图片与 PRD 粘贴图片，已发送会话中的附图引用可能失效。"
            okText="清理"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={loading || imageFiles === 0}
            onConfirm={() =>
              void runCleanup([...WISE_IMAGE_CLEANUP_CATEGORY_IDS], "all-images")
            }
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={busyId === "all-images"}
              disabled={loading || imageFiles === 0}
            >
              清理全部图片
            </Button>
          </Popconfirm>
        </div>

        {gcConfigDraft ? (
          <div className="app-data-cleanup-gc-config">
            <div className="app-data-cleanup-gc-config__title">Composer 图片自动回收</div>
            <div className="app-data-cleanup-gc-config__fields">
              <label className="app-data-cleanup-gc-config__field">
                <span>保留天数</span>
                <InputNumber
                  min={1}
                  max={365}
                  value={gcConfigDraft.ttlDays}
                  disabled={loading}
                  onChange={(value) =>
                    setGcConfigDraft((prev) =>
                      prev ? { ...prev, ttlDays: Math.max(1, Number(value ?? prev.ttlDays)) } : prev,
                    )
                  }
                />
              </label>
              <label className="app-data-cleanup-gc-config__field">
                <span>保护小时</span>
                <InputNumber
                  min={1}
                  max={168}
                  value={gcConfigDraft.graceHours}
                  disabled={loading}
                  onChange={(value) =>
                    setGcConfigDraft((prev) =>
                      prev
                        ? { ...prev, graceHours: Math.max(1, Number(value ?? prev.graceHours)) }
                        : prev,
                    )
                  }
                />
              </label>
              <label className="app-data-cleanup-gc-config__field">
                <span>容量上限 MB</span>
                <InputNumber
                  min={0}
                  max={10240}
                  value={gcConfigDraft.maxMb}
                  disabled={loading}
                  onChange={(value) =>
                    setGcConfigDraft((prev) =>
                      prev ? { ...prev, maxMb: Math.max(0, Number(value ?? prev.maxMb)) } : prev,
                    )
                  }
                />
              </label>
            </div>
            <Typography.Text type="secondary" className="app-data-cleanup-gc-config__hint">
              0 MB 表示不按容量强制回收；保护期内的新附图不会被自动删除。
            </Typography.Text>
            <Button
              size="small"
              type="primary"
              loading={busyId === "composer-config"}
              disabled={loading || !gcConfigDirty}
              onClick={() => void saveGcConfig()}
            >
              保存回收策略
            </Button>
          </div>
        ) : null}

        {categories.map((item) => (
          <div key={item.id} className="app-data-cleanup-row">
            <div className="app-data-cleanup-row__main">
              <span className="app-data-cleanup-row__title">{item.label}</span>
              <span className="app-data-cleanup-row__hint">{item.description}</span>
              <Typography.Text type="secondary" className="app-data-cleanup-row__usage">
                {formatUsageLine(item)}
              </Typography.Text>
            </div>
            <div className="app-data-cleanup-row__control">
              <Space size={4} wrap>
              {item.id === "composer_images" ? (
                <Popconfirm
                  title="清理无引用 Composer 图片？"
                  description="仅删除未被会话引用且超过保留期的图片，不影响当前会话附图。"
                  okText="清理"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={loading || composerGcEligible === 0}
                  onConfirm={() => void runComposerGc()}
                >
                  <Button
                    size="small"
                    loading={busyId === "composer-gc"}
                    disabled={loading || composerGcEligible === 0}
                  >
                    清理无引用
                    {composerGcEligible > 0 ? ` (${formatBytes(composerGcBytes)})` : ""}
                  </Button>
                </Popconfirm>
              ) : null}
              <Popconfirm
                title={`清理「${item.label}」？`}
                description={
                  item.id === "prd_runs"
                    ? "将删除 ~/.wise/prd-runs 下全部快照；进行中的 PRD 拆分可能需重新物化。"
                    : `将删除 ${item.path} 下的全部文件。`
                }
                okText="清理"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                disabled={loading || !item.exists || item.fileCount === 0}
                onConfirm={() => void runCleanup([item.id], item.id)}
              >
                <Button
                  size="small"
                  danger
                  loading={busyId === item.id}
                  disabled={loading || !item.exists || item.fileCount === 0}
                >
                  清理
                </Button>
              </Popconfirm>
              </Space>
            </div>
          </div>
        ))}
      </section>

      <aside className="app-data-cleanup-panel__notes" aria-label="数据清理说明">
        <div className="app-data-cleanup-panel__notes-title">说明</div>
        <ul className="app-data-cleanup-panel__notes-list">
          {(gcConfig ? buildDataCleanupNotes(gcConfig) : buildDataCleanupNotes({ ttlDays: 30, graceHours: 24, maxMb: 500 })).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
