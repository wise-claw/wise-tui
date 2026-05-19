import React from "react";
import ReactDOM from "react-dom/client";
import "@douyinfe/semi-ui/lib/es/_base/base.css";
import App from "./App";
import { bootstrapDompurifyForTauriAssets } from "./bootstrapDompurifyForTauriAssets";
import { applyTauriMacHostChromeClass } from "./utils/applyTauriMacHostChromeClass";
import { ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";

applyTauriMacHostChromeClass();
ensureTauriEventUnlistenPatched();
bootstrapDompurifyForTauriAssets();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
