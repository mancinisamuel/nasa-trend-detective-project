import { DemoPage, isDemoPath } from "../features/demo/DemoPage";
import { App } from "./App";
import { isAppHomePath, NotFoundPage } from "./NotFoundPage";

/** Chooses the demo page, start page, or 404 screen from the URL; there is no router. */
export function Root() {
  const pathname = window.location.pathname;
  if (isDemoPath(pathname)) {
    return <DemoPage />;
  }
  if (isAppHomePath(pathname)) {
    return <App />;
  }
  return <NotFoundPage />;
}
