import { Button, Input, Space } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}

export function ListEditor({ items, onChange, placeholder }: ListEditorProps) {
  const [draft, setDraft] = useState("");
  const addDraft = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <Space orientation="vertical" size={4} className="mission-list-editor">
      {items.map((item, index) => (
        <Space key={`${item}-${index}`} className="mission-list-editor__row">
          <Input
            size="small"
            value={item}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <Button
            aria-label="删除条目"
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          />
        </Space>
      ))}
      <Space className="mission-list-editor__row">
        <Input
          size="small"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={addDraft}
        />
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addDraft}>
          添加
        </Button>
      </Space>
    </Space>
  );
}
