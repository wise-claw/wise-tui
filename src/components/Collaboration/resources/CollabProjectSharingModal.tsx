import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import {
  createCollabSpace,
  formatCollabError,
  listCollabResources,
  listCollabResourceUpdates,
  onCollabChanged,
  resourceKindLabel,
  resourceVisibilityLabel,
  setCollabSpaceMember,
  subscribeCollabResource,
  projectSelectOptions,
} from "../../../services/collaboration";
import { closeCollabProjectSharing, useCollabProjectSharing } from "../../../stores/collabUiStore";
import type { CollabResource, CollabSpace, CollabSubscriptionUpdate } from "../../../types/collaboration";
import { CollabResourceCreateModal } from "./CollabResourceCreateModal";
import { CollabResourceDrawer } from "./CollabResourceDrawer";
import { projectLabel, useCollabDirectory } from "./useCollabDirectory";
import "../collaboration.css";

/** 项目设置中的「协作与共享」：协作空间与成员项目、本项目发布的资源、可访问的来源资源与订阅升级。 */
export function CollabProjectSharingModal() {
  const scope = useCollabProjectSharing();
  const { message } = AntApp.useApp();
  const directory = useCollabDirectory(scope != null);
  const projectId = scope?.projectId ?? null;
  const [resources, setResources] = useState<CollabResource[]>([]);
  const [updates, setUpdates] = useState<CollabSubscriptionUpdate[]>([]);
  const [newSpace, setNewSpace] = useState({ name: "", description: "" });
  const [addMember, setAddMember] = useState<Record<string, string | undefined>>({});
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    void listCollabResources(projectId)
      .then(setResources)
      .catch(() => setResources([]));
    void listCollabResourceUpdates("project", projectId)
      .then(setUpdates)
      .catch(() => setUpdates([]));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    load();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCollabChanged((rid) => {
      if (rid == null) load();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load, projectId]);

  if (!scope || !projectId) return null;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) message.success(ok);
      directory.reloadSpaces();
      load();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const own = resources.filter((r) => r.ownerProjectId === projectId);
  const external = resources.filter((r) => r.ownerProjectId !== projectId);
  const mySpaces = directory.spaces.filter((s) => s.members.some((m) => m.projectId === projectId));
  const otherSpaces = directory.spaces.filter((s) => !s.members.some((m) => m.projectId === projectId));

  const spaceCard = (s: CollabSpace) => {
    const role = s.members.find((m) => m.projectId === projectId)?.role;
    const candidates = directory.projects.filter((p) => !s.members.some((m) => m.projectId === p.id));
    return (
      <div key={s.id} className="collab-space-card">
        <div className="collab-space-card__head">
          <Typography.Text strong>{s.name}</Typography.Text>
          {role ? <Tag color={role === "owner" ? "processing" : "default"}>{role === "owner" ? "创建方" : "成员"}</Tag> : null}
          {role && role !== "owner" ? (
            <Popconfirm title="退出后本项目不再读取该空间的共享资源" onConfirm={() => void run(() => setCollabSpaceMember(s.id, projectId, false), "已退出")}>
              <Button size="small" type="link" danger>
                退出
              </Button>
            </Popconfirm>
          ) : null}
        </div>
        {s.description ? <Typography.Text type="secondary">{s.description}</Typography.Text> : null}
        <div className="collab-space-card__members">
          {s.members.map((m) => (
            <Tag
              key={m.projectId}
              closable={role === "owner" && m.projectId !== projectId}
              onClose={(e) => {
                e.preventDefault();
                void run(() => setCollabSpaceMember(s.id, m.projectId, false), "已移除成员");
              }}
            >
              {projectLabel(directory.projects, m.projectId, directory.repositories)}
            </Tag>
          ))}
        </div>
        {role === "owner" ? (
          <Space.Compact size="small">
            <Select
              size="small"
              style={{ width: 200 }}
              placeholder="添加成员项目"
              value={addMember[s.id]}
              options={projectSelectOptions(candidates, directory.repositories)}
              onChange={(v) => setAddMember((m) => ({ ...m, [s.id]: v }))}
            />
            <Button
              size="small"
              disabled={!addMember[s.id]}
              onClick={() => {
                const pid = addMember[s.id];
                if (!pid) return;
                void run(async () => {
                  await setCollabSpaceMember(s.id, pid, true);
                  setAddMember((m) => ({ ...m, [s.id]: undefined }));
                }, "已添加成员");
              }}
            >
              添加
            </Button>
          </Space.Compact>
        ) : null}
      </div>
    );
  };

  const resourceColumns = [
    {
      title: "资源",
      render: (_: unknown, r: CollabResource) => (
        <Button type="link" size="small" onClick={() => setOpenId(r.id)}>
          {r.title}
        </Button>
      ),
    },
    { title: "类型", width: 90, render: (_: unknown, r: CollabResource) => resourceKindLabel(r.kind) },
    { title: "可见范围", width: 100, render: (_: unknown, r: CollabResource) => <Tag>{resourceVisibilityLabel(r.visibility)}</Tag> },
    { title: "版本", width: 60, render: (_: unknown, r: CollabResource) => `v${r.latestVersion}` },
    { title: "维护者", width: 110, render: (_: unknown, r: CollabResource) => r.maintainer || "—" },
  ];

  return (
    <Modal open title={`协作与共享 · ${scope.title}`} width={860} footer={null} onCancel={closeCollabProjectSharing} destroyOnClose>
      <Tabs
        size="small"
        items={[
          {
            key: "spaces",
            label: `协作空间（${mySpaces.length}）`,
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Text type="secondary">协作空间是多个项目共同使用的一组资源；发布到空间的资源对全部成员项目可见。</Typography.Text>
                {mySpaces.length ? mySpaces.map(spaceCard) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本项目尚未加入协作空间" />}
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    size="small"
                    placeholder="新协作空间名称"
                    value={newSpace.name}
                    onChange={(e) => setNewSpace((s) => ({ ...s, name: e.target.value }))}
                  />
                  <Input
                    size="small"
                    placeholder="说明（可选）"
                    value={newSpace.description}
                    onChange={(e) => setNewSpace((s) => ({ ...s, description: e.target.value }))}
                  />
                  <Button
                    size="small"
                    type="primary"
                    disabled={!newSpace.name.trim()}
                    onClick={() =>
                      void run(async () => {
                        await createCollabSpace(newSpace.name.trim(), projectId, newSpace.description.trim());
                        setNewSpace({ name: "", description: "" });
                      }, "已创建协作空间")
                    }
                  >
                    创建
                  </Button>
                </Space.Compact>
                {otherSpaces.length ? (
                  <>
                    <div className="collab-section-title">其他协作空间</div>
                    {otherSpaces.map(spaceCard)}
                    <Typography.Text type="secondary">加入其他空间需由空间创建方添加。</Typography.Text>
                  </>
                ) : null}
              </Space>
            ),
          },
          {
            key: "published",
            label: `本项目发布（${own.length}）`,
            children: (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Button size="small" type="primary" onClick={() => setCreating(true)}>
                  发布共享资源
                </Button>
                <Table<CollabResource> size="small" rowKey="id" pagination={false} dataSource={own} columns={resourceColumns} locale={{ emptyText: "本项目尚未发布共享资源" }} />
              </Space>
            ),
          },
          {
            key: "sources",
            label: `来源项目资源（${external.length}）`,
            children: (
              <Table<CollabResource>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={external}
                locale={{ emptyText: "没有其他项目授权给本项目的资源" }}
                columns={[
                  ...resourceColumns,
                  { title: "来源项目", width: 130, render: (_: unknown, r: CollabResource) => projectLabel(directory.projects, r.ownerProjectId, directory.repositories) },
                ]}
              />
            ),
          },
          {
            key: "subscriptions",
            label: `订阅（${updates.filter((u) => u.hasUpdate).length} 可升级）`,
            children: (
              <Table<CollabSubscriptionUpdate>
                size="small"
                rowKey="resourceId"
                pagination={false}
                dataSource={updates}
                locale={{ emptyText: "尚未订阅共享资源，可在资源详情的“订阅”页签订阅" }}
                columns={[
                  {
                    title: "资源",
                    render: (_, u) => (
                      <Button type="link" size="small" onClick={() => setOpenId(u.resourceId)}>
                        {u.title}
                      </Button>
                    ),
                  },
                  { title: "跟踪版本", width: 90, render: (_, u) => `v${u.trackedVersion}` },
                  { title: "最新版本", width: 90, render: (_, u) => `v${u.latestVersion}` },
                  {
                    title: "",
                    width: 150,
                    render: (_, u) =>
                      u.hasUpdate ? (
                        <Button size="small" type="link" onClick={() => void run(() => subscribeCollabResource(u.resourceId, "project", projectId), `已升级到 v${u.latestVersion}`)}>
                          升级到 v{u.latestVersion}
                        </Button>
                      ) : (
                        <Tag color="success">已是最新</Tag>
                      ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
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
    </Modal>
  );
}
