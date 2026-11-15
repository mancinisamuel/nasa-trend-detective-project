import { useCompareSelection } from "../src/features/compare/CompareSelection";
import { t } from "../src/i18n";

/**
 * Stand-in for the former timeline CALCULATE button (moved into the side panel, UI-DESIGN-7):
 * the same apply() of the selection, for harnesses without a side panel.
 */
export function CalculateStub() {
  const { apply } = useCompareSelection();
  return (
    <button type="button" onClick={apply}>
      {t("timeline.calculate")}
    </button>
  );
}
