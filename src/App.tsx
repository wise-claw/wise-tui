import { lazy, Suspense } from "react";
import { WorkspaceViewportLoading } from "./components/WorkspaceViewportLoading";

const appImplModule = import("./AppImpl");

const LazyAppImpl = lazy(() => appImplModule);

export default function App() {
  return (
    <Suspense fallback={<WorkspaceViewportLoading />}>
      <LazyAppImpl />
    </Suspense>
  );
}
