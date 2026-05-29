import { DeleteOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "../LeftSidebar/systemSessions";
import {
  cleanupWiseDataCategories,
  listWiseDataCleanupCategories,
  openWiseHomeDir,
  WISE_IMAGE_CLEANUP_CATEGORY_IDS,
  type WiseDataCategoryUsage,
} from "../../services/wiseDataCleanup";
import "./index.css";

const DATA_CLEANUP_NOTES = [
  "清理范围仅限 ~/.wise 下的缓存目录，不会删除 wise.db、repositories.json、tabs.json 或扩展目录。",
  "Composer 图片包含主会话截图、粘贴与上传；PRD 粘贴图片来自需求编辑器。",
  "清理 PRD 拆分快照后，进行中的拆分可能需重新物化；已发送会话中的附图 @ 引用可能失效。",
] as const;

function formatUsageLine(item: WiseDataCategoryUsage): string {
  if (!item.exists || item.fileCount === 0) {
    return "暂无文件";
  }
  return `${item.fileCount} 个文件 · ${formatBytes(item.byteSize)}`;
}

/** 工作台「数据清理」：按类别清理 ~/.wise 缓存（含图片）。 */
export function DataCleanupPanel() {
  const { message } = App.useApp();
  const [categories, setCategories] = useState<WiseDataCategoryUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | "all-images" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await listWiseDataCleanupCategories());
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
        const freed = results.reduce((sum, r) => sum + r.freedBytes, 0);
        if (removed === 0) {
          message.info("所选目录已为空，无需清理");
        } else {
          message.success(`已清理 ${removed} 个文件，释放 ${formatBytes(freed)}`);
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
            </div>
          </div>
        ))}
      </section>

      <aside className="app-data-cleanup-panel__notes" aria-label="数据清理说明">
        <div className="app-data-cleanup-panel__notes-title">说明</div>
        <ul className="app-data-cleanup-panel__notes-list">
          {DATA_CLEANUP_NOTES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
