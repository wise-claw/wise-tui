import { useState } from "react";
import { App as AntApp, Input, List, Modal, Space, Tag, Typography } from "antd";
import { formatCollabError, readCollabResource, searchCollabResources } from "../../../services/collaboration";
import type { CollabResource, CollabResourceVersion, CollabSearchHit } from "../../../types/collaboration";

interface Props {
  projectId: string | null;
  placeholder?: string;
}

/** 授权检索：先按项目授权过滤再做关键词匹配；结果只含片段，全文需显式打开。 */
export function CollabResourceSearch({ projectId, placeholder }: Props) {
  const { message } = AntApp.useApp();
  const [hits, setHits] = useState<CollabSearchHit[] | null>(null);
  const [reading, setReading] = useState<{ resource: CollabResource; version: CollabResourceVersion } | null>(null);

  const search = async (q: string) => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    try {
      setHits(await searchCollabResources(q.trim(), projectId, 20));
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const open = async (resourceId: string, version?: number) => {
    try {
      setReading(await readCollabResource(resourceId, version ?? null));
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  return (
    <>
      <Input.Search allowClear placeholder={placeholder ?? "搜索可访问的共享知识"} onSearch={(q) => void search(q)} />
      {hits ? (
        <List
          size="small"
          dataSource={hits}
          locale={{ emptyText: "没有可访问的匹配资源" }}
          renderItem={(h) => (
            <List.Item style={{ cursor: "pointer" }} onClick={() => void open(h.resourceId, h.version)}>
              <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
                <Space size={6}>
                  <Typography.Text strong>{h.title}</Typography.Text>
                  <Tag>{h.kind}</Tag>
                  <Typography.Text type="secondary">v{h.version}</Typography.Text>
                  {h.maintainer ? <Typography.Text type="secondary">维护：{h.maintainer}</Typography.Text> : null}
                </Space>
                <Typography.Text type="secondary" ellipsis>
                  {h.snippet}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      ) : null}
      <CollabResourceReader value={reading} onClose={() => setReading(null)} />
    </>
  );
}

export function CollabResourceReader({
  value,
  onClose,
}: {
  value: { resource: CollabResource; version: CollabResourceVersion } | null;
  onClose: () => void;
}) {
  return (
    <Modal open={value != null} title={value ? `${value.resource.title} · v${value.version.version}` : ""} footer={null} width={760} onCancel={onClose}>
      {value ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {value.resource.kind} · 哈希 {value.version.contentHash.slice(0, 12)} · 发布于 {new Date(value.version.publishedAt).toLocaleString()}
            {value.version.note ? ` · ${value.version.note}` : ""}
          </Typography.Text>
          <pre className="collab-pre">{value.version.content}</pre>
        </Space>
      ) : null}
    </Modal>
  );
}
