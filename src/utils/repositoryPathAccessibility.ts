/** 将 Rust/IPC 返回的文件树错误转为可操作的换机说明。 */
export function formatRepositoryExplorerLoadError(message: string, repositoryPath: string): string {
  const trimmedPath = repositoryPath.trim();
  if (
    message.includes("在本机不存在") ||
    message.includes("路径不是目录") ||
    /not a directory/i.test(message)
  ) {
    return message;
  }
  const hint = trimmedPath ? `（${trimmedPath}）` : "";
  return `文件树加载失败${hint}：${message}。若刚换电脑，请在本机重新选择仓库目录。`;
}
