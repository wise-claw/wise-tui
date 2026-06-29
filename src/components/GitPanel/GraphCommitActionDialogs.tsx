import { useEffect, useState } from "react";
import { Checkbox, Input, Modal, Radio, Typography, message } from "antd";
import {
  gitCreateBranch,
  gitCreateTag,
  gitPushTag,
  gitRemoteUrl,
  gitReset,
  type GitResetMode,
} from "../../services/git";

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
  const [pushToRemote, setPushToRemote] = useState(true);
  const [remoteAvailable, setRemoteAvailable] = useState(false);
  const [remoteName] = useState("origin");

  useEffect(() => {
    if (!open) return;
    setTagName("");
    setTagMessage("");
    setSubmitting(false);
    setPushToRemote(true);

    // 探测 origin remote 是否配置：无 origin 时 Checkbox 自动降级为 disabled
    let cancelled = false;
    void (async () => {
      try {
        const url = await gitRemoteUrl(repositoryPath);
        if (cancelled) return;
        setRemoteAvailable(Boolean(url && url.trim().length > 0));
      } catch {
        if (!cancelled) setRemoteAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, sha, repositoryPath]);

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
        if (name.includes(" ")) {
          message.warning("标签名不能包含空格");
          return Promise.reject(new Error("tag name has space"));
        }
        setSubmitting(true);
        try {
          await gitCreateTag(repositoryPath, sha, name, tagMessage.trim() || null);
          if (pushToRemote && remoteAvailable) {
            try {
              await gitPushTag(repositoryPath, name, remoteName);
              message.success(`标签 ${name} 已创建并推送到 ${remoteName}`);
            } catch (pushError) {
              const reason = String(pushError ?? "未知错误");
              message.warning(
                `标签 ${name} 已创建到本地，但推送到 ${remoteName} 失败：${reason}`,
              );
            }
          } else {
            message.success(`标签 ${name} 已创建`);
          }
          onSuccess();
          onClose();
        } catch (createError) {
          const reason = String(createError ?? "未知错误");
          message.error(`创建标签失败：${reason}`);
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
        <Checkbox
          checked={pushToRemote && remoteAvailable}
          disabled={!remoteAvailable}
          onChange={(event) => setPushToRemote(event.target.checked)}
        >
          {remoteAvailable
            ? `创建后推送到远程 (${remoteName})`
            : "当前仓库未配置远程，仅在本地创建"}
        </Checkbox>
      </div>
    </Modal>
  );
}
