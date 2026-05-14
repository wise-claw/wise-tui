import { Button, Typography } from "antd";
import { InboxOutlined, PlusOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface InitModeProps {
  onInit: () => void;
  loading: boolean;
}

export function InitMode({ onInit, loading }: InitModeProps) {
  return (
    <div className="git-init-mode">
      <InboxOutlined style={{ fontSize: 32, color: "var(--ant-color-text-tertiary)" }} />
      <Text type="secondary" style={{ fontSize: 13 }}>此项目尚未初始化 Git 仓库</Text>
      <Button
        type="primary"
        size="middle"
        onClick={onInit}
        loading={loading}
        icon={<PlusOutlined />}
      >
        {loading ? "初始化中..." : "初始化 Git"}
      </Button>
    </div>
  );
}
