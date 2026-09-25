import { useState } from "react";
import { App as AntApp, Button, Modal, Popconfirm, Table, Tag, Typography } from "antd";
import { formatCollabError, getCollabAgentRevision, rollbackCollabAgent } from "../../../services/collaboration";
import type { CollabAgentProfile, CollabAgentRevision, CollabAgentRevisionSummary } from "../../../types/collaboration";

interface Props {
  profile: CollabAgentProfile;
  onRolledBack: () => void;
}

const SOURCE_LABEL: Record<string, string> = { publish: "发布", rollback: "回退", import: "导入", duplicate: "复制" };

function stableJson(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

/** 版本历史：查看、与草稿比较、回退（回退生成新版本，不删除旧记录）。 */
export function CollabAgentRevisionsPanel({ profile, onRolledBack }: Props) {
  const { message } = AntApp.useApp();
  const [viewing, setViewing] = useState<CollabAgentRevision | null>(null);

  const rows = [...profile.revisions].sort((a, b) => b.revision - a.revision);

  const diffLines = viewing
    ? (() => {
        const a = stableJson(viewing.config).split("\n");
        const b = stableJson(profile.draft).split("\n");
        const setB = new Set(b);
        const setA = new Set(a);
        return [
          ...a.filter((l) => !setB.has(l)).map((l) => `- ${l}`),
          ...b.filter((l) => !setA.has(l)).map((l) => `+ ${l}`),
        ];
      })()
    : [];

  return (
    <>
      <Table<CollabAgentRevisionSummary>
        size="small"
        rowKey="revision"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "尚未发布版本" }}
        columns={[
          {
            title: "版本",
            width: 90,
            render: (_, r) => (
              <>
                v{r.revision} {r.revision === profile.activeRevision ? <Tag color="green">生效</Tag> : null}
              </>
            ),
          },
          {
            title: "来源",
            width: 110,
            render: (_, r) => (
              <>
                {SOURCE_LABEL[r.source] ?? r.source}
                {r.rollbackOf ? <Typography.Text type="secondary">（自 v{r.rollbackOf}）</Typography.Text> : null}
              </>
            ),
          },
          { title: "说明", dataIndex: "note" },
          { title: "哈希", width: 110, render: (_, r) => r.configHash.slice(0, 10) },
          { title: "时间", width: 170, render: (_, r) => new Date(r.createdAt).toLocaleString() },
          {
            title: "",
            width: 150,
            render: (_, r) => (
              <>
                <Button
                  size="small"
                  type="link"
                  onClick={() =>
                    void getCollabAgentRevision(profile.id, r.revision)
                      .then(setViewing)
                      .catch((e) => message.error(formatCollabError(e)))
                  }
                >
                  查看
                </Button>
                {r.revision !== profile.activeRevision ? (
                  <Popconfirm
                    title={`回退到 v${r.revision}？将发布为新版本，后续新需求生效`}
                    onConfirm={async () => {
                      try {
                        await rollbackCollabAgent(profile.id, r.revision, profile.rowVersion);
                        message.success("已回退并发布为新版本");
                        onRolledBack();
                      } catch (e) {
                        message.error(formatCollabError(e));
                      }
                    }}
                  >
                    <Button size="small" type="link">
                      回退
                    </Button>
                  </Popconfirm>
                ) : null}
              </>
            ),
          },
        ]}
      />
      <Modal
        open={viewing != null}
        title={viewing ? `v${viewing.revision} 与当前草稿的差异` : ""}
        footer={null}
        width={760}
        onCancel={() => setViewing(null)}
      >
        {diffLines.length ? (
          <pre className="collab-pre">{diffLines.join("\n")}</pre>
        ) : (
          <Typography.Text type="secondary">与当前草稿一致</Typography.Text>
        )}
      </Modal>
    </>
  );
}
