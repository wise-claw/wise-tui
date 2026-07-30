import { getTerminalThemeState, subscribeTerminalTheme } from "../stores/terminalThemeStore";
import { setTerminalTheme } from "./terminal";

/**
 * 把内置终端解析后的浅/深推给后端。
 *
 * PTY 会话在后端长驻，且帧颜色是在 Rust 侧序列化时解析的，因此调色板必须是
 * 一份进程级状态：放在面板组件里推送会漏掉未挂载面板的会话（后台脚本、隐藏 tab），
 * 所以由主窗口入口启动一次全局订阅。
 *
 * 解析来源：默认配置 `terminalThemeMode`（跟随应用 / 浅 / 深）经 `terminalThemeStore`
 * 与应用外观合成；不再直接绑死应用外观。
 */

let lastPushedDark: boolean | null = null;
let disposer: (() => void) | null = null;

function pushTheme(dark: boolean): void {
  if (lastPushedDark === dark) return;
  lastPushedDark = dark;
  void setTerminalTheme(dark).catch((error) => {
    // 推送失败不影响终端可用性，仅退回旧配色；下次外观变化会重试。
    lastPushedDark = null;
    console.warn("sync terminal theme failed", error);
  });
}

/** 幂等；重复调用返回同一个 disposer 语义。 */
export function startTerminalThemeSync(): () => void {
  if (disposer) return disposer;
  pushTheme(getTerminalThemeState().dark);
  const unsubscribe = subscribeTerminalTheme(() => {
    pushTheme(getTerminalThemeState().dark);
  });
  disposer = () => {
    unsubscribe();
    disposer = null;
  };
  return disposer;
}
