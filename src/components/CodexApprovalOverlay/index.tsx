import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Modal, Button, Space, Typography } from 'antd';
import {
  onCodexApprovalRequest,
  onCodexApprovalResolved,
  respondCodexApproval,
  type CodexApprovalRequestPayload,
} from '../../services/codexRpc';

const { Text, Paragraph } = Typography;

export const CodexApprovalOverlay: React.FC = () => {
  const [pendingApproval, setPendingApproval] = useState<CodexApprovalRequestPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Use a ref so the resolved-listener closure always sees the latest approval.
  const pendingRef = useRef<CodexApprovalRequestPayload | null>(null);
  pendingRef.current = pendingApproval;

  useEffect(() => {
    let unlistenRequest: (() => void) | undefined;
    let unlistenResolved: (() => void) | undefined;

    const setup = async () => {
      const reqUnlisten = await onCodexApprovalRequest((payload) => {
        setPendingApproval(payload);
        setLoading(false);
      });
      unlistenRequest = reqUnlisten;

      const resUnlisten = await onCodexApprovalResolved((payload) => {
        const current = pendingRef.current;
        if (current && payload.request_id === current.request_id) {
          setPendingApproval(null);
          setLoading(false);
        }
      });
      unlistenResolved = resUnlisten;
    };

    setup();

    return () => {
      unlistenRequest?.();
      unlistenResolved?.();
    };
  }, []);

  const handleDecision = useCallback(async (decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') => {
    const current = pendingRef.current;
    if (!current) return;
    setLoading(true);
    try {
      await respondCodexApproval(current.session_id, current.request_id, decision);
    } catch (e) {
      console.error('Failed to send approval decision:', e);
      setLoading(false);
    }
  }, []);

  if (!pendingApproval) return null;

  const title =
    pendingApproval.type === 'commandExecution'
      ? '命令执行审批'
      : pendingApproval.type === 'fileChange'
        ? '文件变更审批'
        : '审批请求';

  return (
    <Modal
      open={true}
      title={title}
      closable={false}
      maskClosable={false}
      footer={null}
      width={600}
    >
      {pendingApproval.type === 'commandExecution' && (
        <div>
          {pendingApproval.reason && (
            <Paragraph><Text strong>原因：</Text>{pendingApproval.reason}</Paragraph>
          )}
          <Paragraph><Text strong>命令：</Text></Paragraph>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto' }}>
            <code>{pendingApproval.command}</code>
          </pre>
          {pendingApproval.cwd && (
            <Paragraph><Text strong>工作目录：</Text><Text code>{pendingApproval.cwd}</Text></Paragraph>
          )}
        </div>
      )}

      {pendingApproval.type === 'fileChange' && (
        <div>
          {pendingApproval.reason && (
            <Paragraph>{pendingApproval.reason}</Paragraph>
          )}
        </div>
      )}

      {pendingApproval.type === 'unknown' && (
        <Paragraph>
          服务器发起了一个未知类型的审批请求{pendingApproval.method ? `（${pendingApproval.method}）` : ''}。
        </Paragraph>
      )}

      <Space style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          danger
          onClick={() => handleDecision('decline')}
          loading={loading}
        >
          拒绝
        </Button>
        <Button
          onClick={() => handleDecision('acceptForSession')}
          loading={loading}
        >
          本次会话全部允许
        </Button>
        <Button
          type="primary"
          onClick={() => handleDecision('accept')}
          loading={loading}
        >
          允许
        </Button>
      </Space>
    </Modal>
  );
};
