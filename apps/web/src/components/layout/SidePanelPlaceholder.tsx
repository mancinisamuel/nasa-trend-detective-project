import { t } from "../../i18n";

/** Placeholder only; the panel content comes later. */
export function SidePanelPlaceholder() {
  return (
    <aside
      className="layout-placeholder app-layout__panel"
      data-testid="side-panel"
    >
      {t("layout.sidePanel")}
    </aside>
  );
}
