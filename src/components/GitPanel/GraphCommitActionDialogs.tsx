import { useEffect, useState } from "react";
import { Input, Modal, Radio, Typography, message } from "antd";
import { gitCreateBranch, gitCreateTag, gitReset, type GitResetMode } from "../../services/git";

const { Text } = Typography;

interface GraphCreateBranchDialogProps {
  open: boolean;
  sha: string;
  repositoryPath: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function GraphCreateBranchDialog({
  open,
  sha,
  repositoryPath,
  onClose,
  onSuccess,
}: GraphCreateBranchDialogProps) {
  const [branchName, setBranchName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setBranchName("");
    }
  }, [open, sha]);

  return (
    <Modal
      title="从此提交创建分支"
      open={open}
      okText="创建并检出"
      confirmLoading={submitting}
      destroyOnHidden
      onCancel={onClose}
      onOk={async () => {
        const name = branchName.trim();
        if (!name) {
          message.warning("请输入分支名");
          return Promise.reject(new Error("branch name required"));
        }
        setSubmitting(true);
        try {
          await gitCreateBranch(repositoryPath, name, sha, true, true);
          onSuccess();
          onClose();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="git-graph-action-dialog">
        <Text type="secondary" style={{ fontSize: 11 }}>
          基于提交 {sha.slice(0, 7)}
        </Text>
        <Input
          autoFocus
          value={branchName}
          placeholder="feature/my-work"
          onChange={(event) => setBranchName(event.target.value)}
          onPressEnter={(event) => {
            event.preventDefault();
            void (async () => {
              const name = branchName.trim();
              if (!name) {
                return;
              }
              setSubmitting(true);
              try {
                await gitCreateBranch(repositoryPath, name, sha, true, true);
                onSuccess();
                onClose();
              } finally {
                setSubmitting(false);
              }
            })();
          }}
        />
      </div>
    </Modal>
  );
}

interface GraphResetDialogProps {
  open: boolean;
  sha: string;
  repositoryPath: string;
  onClose: () => void;
  onSuccess: () => void;
}

const RESET_OPTIONS: Array<{ value: GitResetMode; label: string; hint: string }> = [
  { value: "soft", label: "Soft", hint: "移动 HEAD，保留暂存区与工作区" },
  { value: "mixed", label: "Mixed", hint: "移动 HEAD，清空暂存区，保留工作区" },
  { value: "hard", label: "Hard", hint: "移动 HEAD，并丢弃所有本地改动" },
];

export function GraphResetDialog({
  open,
  sha,
  repositoryPath,
  onClose,
  onSuccess,
}: GraphResetDialogProps) {
  const [mode, setMode] = useState<GitResetMode>("mixed");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("mixed");
    }
  }, [open, sha]);

  return (
    <Modal
      title="Reset 到此提交"
      open={open}
      okText="Reset"
      okButtonProps={{ danger: mode === "hard" }}
      confirmLoading={submitting}
      destroyOnHidden
      onCancel={onClose}
      onOk={async () => {
        setSubmitting(true);
        try {
          await gitReset(repositoryPath, sha, mode);
          onSuccess();
          onClose();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="git-graph-action-dialog">
        <Text type="secondary" style={{ fontSize: 11 }}>
          将当前分支重置到 {sha.slice(0, 7)}
        </Text>
        <Radio.Group
          value={mode}
          onChange={(event) => setMode(event.target.value as GitResetMode)}
          className="git-graph-reset-options"
        >
          {RESET_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value} className="git-graph-reset-option">
              <span className="git-graph-reset-option__label">{option.label}</span>
              <span className="git-graph-reset-option__hint">{option.hint}</span>
            </Radio>
          ))}
        </Radio.Group>
      </div>
    </Modal>
  );
}

interface GraphCreateTagDialogProps {
  open: boolean;
  sha: string;
  repositoryPath: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function GraphCreateTagDialog({
  open,
  sha,
  repositoryPath,
  onClose,
  onSuccess,
}: GraphCreateTagDialogProps) {
  const [tagName, setTagName] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTagName("");
      setTagMessage("");
    }
  }, [open, sha]);

  return (
    <Modal
      title="创建标签"
      open={open}
      okText="创建"
      confirmLoading={submitting}
      destroyOnHidden
      onCancel={onClose}
      onOk={async () => {
        const name = tagName.trim();
        if (!name) {
          message.warning("请输入标签名");
          return Promise.reject(new Error("tag name required"));
        }
        setSubmitting(true);
        try {
          await gitCreateTag(repositoryPath, sha, name, tagMessage.trim() || null);
          onSuccess();
          onClose();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="git-graph-action-dialog">
        <Text type="secondary" style={{ fontSize: 11 }}>
          标记提交 {sha.slice(0, 7)}
        </Text>
        <Input
          autoFocus
          value={tagName}
          placeholder="v1.0.0"
          onChange={(event) => setTagName(event.target.value)}
        />
        <Input.TextArea
          value={tagMessage}
          placeholder="附注说明（可选，填写后创建 annotated tag）"
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={(event) => setTagMessage(event.target.value)}
        />
      </div>
    </Modal>
  );
}
