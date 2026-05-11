/** 聊天列表时间：当天仅 HH:mm，同年为 M/D HH:mm，否则 Y/M/D HH:mm（均为 24 小时制）。 */
export function formatChatMessageListTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return hm;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}`;
}
