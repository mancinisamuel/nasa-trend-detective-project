import { Component, type ReactNode } from "react";

import { Button } from "../components/ui/Button";
import { t } from "../i18n";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Global render-error screen (UI-ERR). The fallback never shows a message or stack
 * from the error; Reload uses a full page reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Keep the error out of state and out of the DOM.
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-screen" role="alert" data-testid="error-boundary">
        <div className="error-screen__card">
          <h1 className="error-screen__title">{t("error.boundary.title")}</h1>
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t("error.boundary.reload")}
          </Button>
        </div>
      </div>
    );
  }
}
