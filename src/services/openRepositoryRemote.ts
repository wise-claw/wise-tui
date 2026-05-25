import { gitRemoteUrl } from "./git";
import { openExternalUrl } from "./openExternal";
import { gitRemoteUrlToBrowseUrl } from "../utils/gitRemoteBrowseUrl";

export type OpenRepositoryRemoteResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/** 读取 origin 远程并在系统默认浏览器中打开仓库网页。 */
export async function openRepositoryRemoteInBrowser(
  repositoryPath: string,
): Promise<OpenRepositoryRemoteResult> {
  const remote = await gitRemoteUrl(repositoryPath);
  if (!remote?.trim()) {
    return { ok: false, message: "未配置 origin 远程地址" };
  }
  const browseUrl = gitRemoteUrlToBrowseUrl(remote);
  if (!browseUrl) {
    return { ok: false, message: "无法从远程地址生成网页链接" };
  }
  await openExternalUrl(browseUrl);
  return { ok: true, url: browseUrl };
}
