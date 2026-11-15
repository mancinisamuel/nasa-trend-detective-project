import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ErrorBoundary } from "./app/ErrorBoundary";
import { AppProviders } from "./app/providers";
import { Root } from "./app/Root";
import "./styles/tokens.css";
import "./styles/global.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root is missing in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </AppProviders>
  </StrictMode>,
);
