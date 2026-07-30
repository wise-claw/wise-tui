import { getAppThemeState, subscribeAppTheme } from "../stores/appThemeStore";
import { setTerminalTheme } from "./terminal";

/**
 * 把应用外观（浅色 / 深色 / 跟随系统解析后的结果）推给内置终端后端。
 *
 * PTY 会话在后端长驻，且帧颜色是在 Rust 侧序列化时解析的，因此调色板必须是
 * 一份进程级状态：放在面板组件里推送会漏掉未挂载面板的会话（后台脚本、隐藏 tab），
 * 所以由主窗口入口启动一次全局订阅。
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
  pushTheme(getAppThemeState().dark);
  const unsubscribe = subscribeAppTheme(() => {
    pushTheme(getAppThemeState().dark);
  });
  disposer = () => {
    unsubscribe();
    disposer = null;
  };
  return disposer;
}
