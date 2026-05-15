import { Card, Input, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import type { EngineeringDetailsVM } from "../presenter/types";
import { ValidationIssueList } from "./ValidationIssueList";

interface ClusterDetailsCardProps {
  cluster: EngineeringDetailsVM["clusters"][number];
  onRename: (clusterId: string, title: string) => void;
}

export function ClusterDetailsCard({ cluster, onRename }: ClusterDetailsCardProps) {
  const [title, setTitle] = useState(cluster.title);
  useEffect(() => {
    setTitle(cluster.title);
  }, [cluster.title]);
  return (
    <Card size="small" title={<Space><Typography.Text code>{cluster.id}</Typography.Text>{cluster.title}</Space>}>
      <Input
        size="small"
        value={title}
        addonBefore="任务分组名"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => onRename(cluster.id, title)}
      />
      <Space wrap size={6}>
        <Tag>{cluster.runStatusInternal}</Tag>
        <Tag>{cluster.diff}</Tag>
        {cluster.parentTaskName ? <Tag>{cluster.parentTaskName}</Tag> : null}
      </Space>
      {cluster.dirtyReasons.length > 0 ? (
        <Typography.Paragraph className="mission-engineering-card__reasons">
          {cluster.dirtyReasons.join(", ")}
        </Typography.Paragraph>
      ) : null}
      <ValidationIssueList issues={cluster.validationIssues} />
    </Card>
  );
}
