import { useCallback, useEffect, useState } from "react";
import { Button, Select, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  listCollabResources,
  onCollabChanged,
  projectSelectOptions,
  resourceKindLabel,
  resourceVisibilityLabel,
} from "../../../services/collaboration";
import type { CollabResource } from "../../../types/collaboration";
import { CollabResourceCreateModal } from "./CollabResourceCreateModal";
import { CollabResourceDrawer } from "./CollabResourceDrawer";
import { CollabResourceSearch } from "./CollabResourceSearch";
import { projectLabel, useCollabDirectory } from "./useCollabDirectory";
import "../collaboration.css";

function activeGrantCount(r: CollabResource): number {
  return r.grants.filter((g) => (g as { revokedAt?: unknown } | null)?.revokedAt == null).length;
}

/** Hub 的「共享资源」：资源搜索、授权范围、版本与适用项目。 */
export function CollabResourcesHubSection() {
  const directory = useCollabDirectory(true);
  const [resources, setResources] = useState<CollabResource[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    void listCollabResources(projectId)
      .then(setResources)
      .catch(() => setResources([]));
  }, [projectId]);

  useEffect(() => {
    load();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCollabChanged((rid) => {
      if (rid == null) load();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load]);

  return (
    <section className="cockpit-hub__recents collab-hub-agents" aria-label="共享资源">
      <div className="collab-hub-agents__head">
        <h2 className="cockpit-hub__section-title">共享资源</h2>
        <span className="collab-hub-resources__actions">
          <Select
            size="small"
            allowClear
            placeholder="按适用项目查看"
            style={{ width: 160 }}
            value={projectId ?? undefined}
            options={projectSelectOptions(directory.projects, directory.repositories)}
            onChange={(v) => setProjectId(v ?? null)}
          />
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            发布
          </Button>
        </span>
      </div>
      <div className="collab-hub-resources__search">
        <CollabResourceSearch projectId={projectId} placeholder={projectId ? "搜索该项目可访问的共享资源" : "搜索全部共享资源"} />
      </div>
      {resources.length === 0 ? (
        <p className="collab-hub-agents__empty">
          共享资源是可跨项目复用的规范、接口、环境说明等，保留不可变版本；默认仅来源项目可见，可发布到协作空间或授权指定项目读取。
        </p>
      ) : (
        <ul className="cockpit-hub__recent-list">
          {resources.map((r) => (
            <li key={r.id}>
              <button type="button" className="cockpit-hub__recent-item" onClick={() => setOpenId(r.id)}>
                <span className="cockpit-hub__recent-title">
                  {r.title}
                  <Tag style={{ marginInlineStart: 8 }}>{resourceKindLabel(r.kind)}</Tag>
                  <Tag color={r.visibility === "source" ? "default" : "processing"}>{resourceVisibilityLabel(r.visibility)}</Tag>
                  {r.status !== "active" ? <Tag color="warning">已停用</Tag> : null}
                </span>
                <span className="cockpit-hub__recent-meta">
                  v{r.latestVersion}
                  {" · 来源 "}
                  {projectLabel(directory.projects, r.ownerProjectId, directory.repositories)}
                  {r.maintainer ? ` · 维护 ${r.maintainer}` : ""}
                  {activeGrantCount(r) ? ` · ${activeGrantCount(r)} 个授权` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CollabResourceCreateModal
        open={creating}
        directory={directory}
        presetProjectId={projectId}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          load();
          setOpenId(id);
        }}
      />
      {openId ? (
        <CollabResourceDrawer
          resourceId={openId}
          directory={directory}
          onClose={() => {
            setOpenId(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
