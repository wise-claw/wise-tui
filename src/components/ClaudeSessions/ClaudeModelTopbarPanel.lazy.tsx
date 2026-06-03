import { lazy } from "react";

export const ClaudeModelTopbarPanelLazy = lazy(() =>
  import("./ClaudeModelTopbarPanel").then((module) => ({ default: module.ClaudeModelTopbarPanel })),
);
