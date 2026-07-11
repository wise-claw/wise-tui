import { Button, Modal } from "antd";
import { useState } from "react";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { ComposerCommonPhrasesPanel } from "./ComposerCommonPhrasesPanel";

// 全局常用语管理入口：用于默认配置面板。不绑定仓库，编辑的是全局常用语。
// 全局常用语会对所有仓库以只读形式合并显示（详见 useComposerCommonPhrases 的合并逻辑）。
export function GlobalComposerCommonPhrasesManager() {
  const { phrases, loading, saving, persist } = useComposerCommonPhrases({});
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        管理全局常用语
      </Button>
      <Modal
        open={open}
        title="全局常用语"
        footer={null}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        width={360}
      >
        <ComposerCommonPhrasesPanel
          phrases={phrases}
          loading={loading}
          saving={saving}
          onPersist={persist}
          scope="global"
          hideDefaultInstruction
        />
      </Modal>
    </>
  );
}
