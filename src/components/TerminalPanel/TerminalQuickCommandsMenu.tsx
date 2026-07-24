import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Popover, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  createTerminalQuickCommand,
  terminalQuickCommandLabel,
  type TerminalQuickCommand,
} from "../../constants/terminalQuickCommands";
import {
  loadTerminalQuickCommands,
  saveTerminalQuickCommands,
} from "../../services/terminalQuickCommandsStore";

type TerminalQuickCommandsMenuProps = {
  disabled?: boolean;
  onRun: (command: string) => void;
};

export function TerminalQuickCommandsMenu({
  disabled = false,
  onRun,
}: TerminalQuickCommandsMenuProps) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TerminalQuickCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadTerminalQuickCommands());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(
    async (next: TerminalQuickCommand[]) => {
      setItems(next);
      try {
        const saved = await saveTerminalQuickCommands(next);
        setItems(saved);
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : "快捷指令保存失败",
        );
        await refresh();
      }
    },
    [message, refresh],
  );

  const handleAdd = useCallback(async () => {
    const created = createTerminalQuickCommand({ title, command });
    if (!created) {
      message.warning("请填写要执行的命令");
      return;
    }
    setSaving(true);
    try {
      await persist([...items, created]);
      setTitle("");
      setCommand("");
      setAddOpen(false);
      message.success("已添加快捷指令");
    } finally {
      setSaving(false);
    }
  }, [command, items, message, persist, title]);

  const handleDelete = useCallback(
    async (id: string) => {
      await persist(items.filter((item) => item.id !== id));
    },
    [items, persist],
  );

  // 先关 Popover 再开 Modal，避免 Popover 层叠盖住对话框。
  const openAddModal = useCallback(() => {
    setOpen(false);
    setAddOpen(true);
  }, []);

  const content = (
    <div className="terminal-quick-commands">
      <div className="terminal-quick-commands__header">
        <span>快捷指令</span>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined style={{ fontSize: 12 }} />}
          aria-label="添加快捷指令"
          onClick={openAddModal}
          style={{ width: 20, height: 20, padding: 0 }}
        />
      </div>
      <div className="terminal-quick-commands__body">
        {loading ? (
          <Typography.Text type="secondary" className="terminal-quick-commands__empty">
            加载中…
          </Typography.Text>
        ) : items.length === 0 ? (
          <div className="terminal-quick-commands__empty">
            <Typography.Text type="secondary">暂无快捷指令</Typography.Text>
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined style={{ fontSize: 11 }} />}
              onClick={openAddModal}
              style={{ height: 18, padding: "0 2px", fontSize: 11 }}
            >
              添加
            </Button>
          </div>
        ) : (
          <ul className="terminal-quick-commands__list">
            {items.map((item) => (
              <li key={item.id} className="terminal-quick-commands__row">
                <button
                  type="button"
                  className="terminal-quick-commands__row-main"
                  title={item.command}
                  disabled={disabled}
                  onClick={() => {
                    onRun(item.command);
                    setOpen(false);
                  }}
                >
                  <span className="terminal-quick-commands__row-label">
                    {terminalQuickCommandLabel(item)}
                  </span>
                  {item.title.trim() ? (
                    <span className="terminal-quick-commands__row-cmd">
                      {item.command}
                    </span>
                  ) : null}
                </button>
                <Button
                  type="text"
                  size="small"
                  danger
                  className="terminal-quick-commands__delete"
                  icon={<DeleteOutlined />}
                  aria-label={`删除 ${terminalQuickCommandLabel(item)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDelete(item.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottomLeft"
        destroyOnHidden
        content={content}
        rootClassName="terminal-quick-commands-popover"
      >
        <button
          className="terminal-header-action"
          type="button"
          aria-label="快捷指令"
          aria-haspopup="dialog"
        >
          <span className="terminal-header-action-label">快捷指令</span>
        </button>
      </Popover>
      <Modal
        title="添加快捷指令"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        confirmLoading={saving}
        okText="添加"
        cancelText="取消"
        destroyOnHidden
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="名称" extra="可选；留空则列表显示命令本身">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：查看状态"
              maxLength={80}
              allowClear
            />
          </Form.Item>
          <Form.Item label="命令" required>
            <Input.TextArea
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="例如：git status"
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={2000}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
