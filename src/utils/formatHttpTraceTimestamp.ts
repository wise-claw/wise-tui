function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** 列表行：含毫秒；非今日前缀月/日，非今年前缀年。 */
export function formatHttpTraceTimestampCompact(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";

  const now = new Date();
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;

  if (d.toDateString() === now.toDateString()) {
    return clock;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${clock}`;
}

/** 悬停/详情：完整本地时间（毫秒）。 */
export function formatHttpTraceTimestampFull(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
  );
}
