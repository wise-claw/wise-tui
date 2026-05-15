import { Badge, Space, Tooltip } from "antd";
import type { MissionViewModel } from "../presenter/types";

interface MissionRiskBadgeProps {
  risks: MissionViewModel["risks"];
}

export function MissionRiskBadge({ risks }: MissionRiskBadgeProps) {
  return (
    <Space size={10} className="mission-risk-badges">
      <Tooltip title="需要处理的任务">
        <span>
          阻塞 <Badge count={risks.blockedTaskCount} overflowCount={99} />
        </span>
      </Tooltip>
      <Tooltip title="需要复核的输出问题">
        <span>
          异常 <Badge count={risks.validationIssueCount} overflowCount={99} />
        </span>
      </Tooltip>
      <Tooltip title="跨仓位需求">
        <span>
          跨仓 <Badge count={risks.crossRepoRequirementCount} overflowCount={99} />
        </span>
      </Tooltip>
    </Space>
  );
}
