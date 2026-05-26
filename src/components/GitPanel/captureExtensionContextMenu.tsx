import { Input, Modal } from "antd";
import type { MenuProps } from "antd";
import {
  MCP_MULTI_SERVERS_PREFIX,
  captureExtensionFromRepositoryPath,
} from "../../services/myExtensions";
import type { MyExtensionKind } from "../../types/myExtension";
import {
  defaultExtensionLibraryCaptureName,
  extensionKindLabelCn,
} from "../../utils/extensionLibraryCaptureName";

const CAPTURE_KINDS: Array<{ key: MyExtensionKind; label: string }> = [
  { key: "mcp", label: "MCP" },
  { key: "skill", label: "技能" },
  { key: "plugin", label: "插件" },
  { key: "hook", label: "Hooks" },
  { key: "script", label: "脚本" },
];

export interface BuildCaptureExtensionMenuOptions {
  repositoryPath: string;
  relativePath: string;
  onClose: () => void;
  onSuccess: (itemName: string) => void;
  onError: (message: string) => void;
}

async function runCapture(
  opts: BuildCaptureExtensionMenuOptions,
  kind: MyExtensionKind,
  name?: string,
): Promise<void> {
  try {
    const item = await captureExtensionFromRepositoryPath({
      repositoryPath: opts.repositoryPath,
      relativePath: opts.relativePath,
      kind,
      name,
    });
    opts.onSuccess(item.name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (kind === "mcp" && !name && msg.startsWith(MCP_MULTI_SERVERS_PREFIX)) {
      const serverNames = msg.slice(MCP_MULTI_SERVERS_PREFIX.length).split(",").filter(Boolean);
      await promptMcpServerName(serverNames, (serverName) => runCapture(opts, "mcp", serverName));
      return;
    }
    opts.onError(msg);
  }
}

function promptMcpServerName(
  serverNames: string[],
  onPick: (name: string) => Promise<void>,
): Promise<void> {
  let value = serverNames[0] ?? "";
  return new Promise((resolve, reject) => {
    Modal.confirm({
      title: "选择 MCP 服务器",
      content: (
        <div className="git-files-capture-ext-modal">
          <p>该配置文件包含多个 MCP 服务器，请输入要收录的服务器名称：</p>
          <p className="git-files-capture-ext-modal__hint">可选：{serverNames.join("、")}</p>
          <Input
            defaultValue={value}
            placeholder="服务器名称"
            onChange={(e) => {
              value = e.target.value;
            }}
          />
        </div>
      ),
      okText: "录入",
      cancelText: "取消",
      onOk: async () => {
        const picked = value.trim();
        if (!picked) {
          throw new Error("请输入 MCP 服务器名称");
        }
        try {
          await onPick(picked);
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      onCancel: () => resolve(),
    });
  });
}

function promptExtensionLibraryName(
  kind: MyExtensionKind,
  relativePath: string,
  defaultName: string,
): Promise<string | null> {
  let value = defaultName;
  return new Promise((resolve) => {
    Modal.confirm({
      title: "录入扩展",
      content: (
        <div className="git-files-capture-ext-modal">
          <p>
            将保存到 <code>~/.wise/extension-library</code>，请为扩展命名：
          </p>
          <p className="git-files-capture-ext-modal__meta">
            类型：{extensionKindLabelCn(kind)} · {relativePath}
          </p>
          <Input
            defaultValue={value}
            placeholder="扩展名称"
            maxLength={120}
            onChange={(e) => {
              value = e.target.value;
            }}
          />
        </div>
      ),
      okText: "录入",
      cancelText: "取消",
      onOk: async () => {
        const picked = value.trim();
        if (!picked) {
          throw new Error("请输入扩展名称");
        }
        resolve(picked);
      },
      onCancel: () => resolve(null),
    });
  });
}

async function startCaptureWithName(
  opts: BuildCaptureExtensionMenuOptions,
  kind: MyExtensionKind,
): Promise<void> {
  if (kind === "mcp") {
    await runCapture(opts, kind);
    return;
  }
  const name = await promptExtensionLibraryName(
    kind,
    opts.relativePath,
    defaultExtensionLibraryCaptureName(opts.relativePath),
  );
  if (!name) return;
  await runCapture(opts, kind, name);
}

export function buildCaptureExtensionContextMenuItems(
  opts: BuildCaptureExtensionMenuOptions,
): NonNullable<MenuProps["items"]> {
  const startCapture = (kind: MyExtensionKind) => {
    opts.onClose();
    void startCaptureWithName(opts, kind).catch((e) => {
      opts.onError(e instanceof Error ? e.message : String(e));
    });
  };

  return [
    {
      key: "capture-ext",
      label: "录入扩展",
      children: CAPTURE_KINDS.map((entry) => ({
        key: `capture-ext-${entry.key}`,
        label: entry.label,
        onClick: () => startCapture(entry.key),
      })),
    },
    { type: "divider" },
  ];
}
