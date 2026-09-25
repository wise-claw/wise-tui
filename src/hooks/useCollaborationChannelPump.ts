import { useEffect } from "react";
import { notification } from "antd";
import {
  ackCollabOutbox,
  formatCollabNotification,
  getCollabChannelSettings,
  hydrateCollabChannelSettings,
  listDueCollabOutbox,
  routeCollabOutboxItem,
} from "../services/collaboration";
import { sendCollabExternalNotification } from "../services/collaboration/channelDelivery";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { openCollabRequirementDetail } from "../stores/collabUiStore";

const PUMP_INTERVAL_MS = 15_000;
const BATCH = 20;

/**
 * 协作渠道泵：消费 `channel` outbox，按设置弹出桌面提醒并转发到远程入口已配置的渠道；
 * 成功 ack 推进渠道投递为 delivered，失败回写错误并由后端退避重试。仅主窗口运行。
 */
export function useCollaborationChannelPump(): void {
  useEffect(() => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    let disposed = false;
    let running = false;

    const tick = async () => {
      if (disposed || running) return;
      running = true;
      try {
        await hydrateCollabChannelSettings();
        const items = await listDueCollabOutbox("channel", BATCH);
        for (const item of items) {
          if (disposed) break;
          const settings = getCollabChannelSettings();
          if (routeCollabOutboxItem(settings, item.message) === "skip" || !item.message) {
            await ackCollabOutbox(item.id, true);
            continue;
          }
          const note = formatCollabNotification(item.requirementTitle, item.message);
          if (settings.desktopToast && item.attempts === 0) {
            notification.open({
              key: `collab-${item.id}`,
              message: note.title,
              description: `${note.text}（点击查看）`,
              placement: "bottomRight",
              duration: 8,
              onClick: () => openCollabRequirementDetail(item.requirementId),
            });
          }
          try {
            await sendCollabExternalNotification(settings.external, note);
            await ackCollabOutbox(item.id, true);
          } catch (e) {
            await ackCollabOutbox(item.id, false, e instanceof Error ? e.message : String(e));
          }
        }
      } catch (e) {
        console.warn("[collab] channel pump failed", e);
      } finally {
        running = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), PUMP_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
}
