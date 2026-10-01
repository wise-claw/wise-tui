import { Button, Dropdown } from "antd";
import { CodeOutlined, DownOutlined, FolderOpenOutlined, MessageOutlined } from "@ant-design/icons";
import { requestRepositoryCardAction } from "../../constants/repositoryCardEvents";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import { buildOpenAppConfigureMenuChildren, parseOpenAppConfigureMenuKey, repositoryEditorOpenMenuLabel, resolveEffectiveOpenAppId } from "../../utils/openAppScope";
import { getKnownOpenAppIcon } from "../OpenAppMenu/openAppIcons";
import { repositoryTerminalOpenAppIcon, repositoryTerminalOpenMenuLabel } from "../../utils/repositoryTerminalOpenMenu";
import { DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";

export function RepositoryCardActions({ entry }: { entry: GitPanelRepositoryEntry }) {
  const editorIcon = getKnownOpenAppIcon(resolveEffectiveOpenAppId(entry.openAppId));
  const terminalIcon = repositoryTerminalOpenAppIcon();
  const request = (action: "terminal" | "editor" | "session" | "files") =>
    requestRepositoryCardAction({ entry, action });
  return (
    <div className="repository-card-actions" aria-label={`${entry.name} 仓库操作`}>
      <Button size="small" type="text" title={repositoryTerminalOpenMenuLabel()} icon={<img className="repository-card-app-icon" src={terminalIcon} alt="" aria-hidden />} onClick={() => request("terminal")}>终端</Button>
      <Button size="small" type="text" title={repositoryEditorOpenMenuLabel(entry.openAppId)} aria-label={repositoryEditorOpenMenuLabel(entry.openAppId)} className="repository-card-actions__editor" icon={editorIcon ? <img className="repository-card-app-icon" src={editorIcon} alt="" aria-hidden /> : <CodeOutlined />} onClick={() => request("editor")} />
      <Dropdown trigger={["click"]} menu={{
        items: buildOpenAppConfigureMenuChildren(entry.openAppId, DEFAULT_OPEN_APP_TARGETS.filter(target => target.kind !== "finder" && !["terminal", "ghostty"].includes(target.id))),
        onClick: ({ key }) => {
          const openAppId = parseOpenAppConfigureMenuKey(key);
          if (openAppId !== undefined) requestRepositoryCardAction({ entry, action: "configure-editor", openAppId });
        },
      }}>
        <Button size="small" type="text" icon={<DownOutlined />} aria-label={`配置 ${entry.name} 的 IDE`} title="配置此仓库的 IDE" />
      </Dropdown>
      <Button size="small" type="text" icon={<MessageOutlined />} disabled={entry.repositoryId < 0} onClick={() => request("session")}>新会话</Button>
      <Button size="small" type="text" icon={<FolderOpenOutlined />} onClick={() => request("files")}>目录</Button>
    </div>
  );
}
