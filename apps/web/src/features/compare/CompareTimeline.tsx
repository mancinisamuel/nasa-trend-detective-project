import { useId, useState } from "react";

import { YearRangeSlider } from "../../components/ui/YearRangeSlider";
import { t } from "../../i18n";
import {
  clampYearRange,
  yearBoundsForVariable,
  type YearRange,
} from "./compareRequest";
import { useCompareSelection } from "./CompareSelection";
import type { CatalogResponse } from "./contract";

/** Field input: start never after end, both inside the variable's years, max_years_per_request kept. */
function commitYear(
  catalog: CatalogResponse,
  range: YearRange,
  field: "start" | "end",
  year: number,
  variableId: string,
): YearRange {
  const { min_year, max_year } = yearBoundsForVariable(catalog, variableId);
  const within = Math.min(max_year, Math.max(min_year, year));
  const next =
    field === "start"
      ? { start: Math.min(within, range.end), end: range.end }
      : { start: range.start, end: Math.max(within, range.start) };
  return clampYearRange(catalog, next, field, variableId);
}

type YearFieldProps = {
  field: "start" | "end";
  year: number;
  onYear: (year: number) => void;
};

function YearField({ field, year, onYear }: YearFieldProps) {
  const inputId = useId();
  const name = t(field === "start" ? "timeline.start" : "timeline.end");
  // While typing the field keeps its own text; Enter or blur commits, the bar follows.
  const [text, setText] = useState<string | null>(null);

  function commit() {
    if (text === null) return;
    const parsed = Number.parseInt(text, 10);
    setText(null);
    if (Number.isInteger(parsed)) onYear(parsed);
  }

  return (
    <div className="timeline__field" role="group" aria-label={name}>
      <label className="visually-hidden" htmlFor={inputId}>
        {name}
      </label>
      <input
        id={inputId}
        className="timeline__year"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text ?? String(year)}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setText(null);
        }}
      />
    </div>
  );
}

/**
 * Timeline v2 (TL-2) in the floating dock under the globe (UI-DESIGN-12): tick bar with the
 * selected variable's available years and the start/end fields (the disabled month "+" was dropped,
 * UI-DESIGN-15). CALCULATE moved to the side panel (UI-DESIGN-7) and uses this period.
 */
export function CompareTimeline() {
  const { catalog, draft, setRange } = useCompareSelection();
  const data = catalog.data;
  if (data === undefined || draft === null) {
    // Keeps the row height while the catalog loads; status is shown in the sheet.
    return <div className="timeline" aria-hidden="true" />;
  }
  const { min_year, max_year } = yearBoundsForVariable(data, draft.variableId);
  const range = draft.range;

  return (
    <div className="timeline" data-testid="compare-timeline">
      <div className="timeline__bar">
        <YearRangeSlider
          label={t("layout.timeframe.label")}
          startLabel={t("timeline.start")}
          endLabel={t("timeline.end")}
          scaleMin={min_year}
          scaleMax={max_year}
          min={min_year}
          max={max_year}
          value={range}
          onChange={(next, changed) => {
            setRange(
              changed === "both"
                ? next
                : clampYearRange(data, next, changed, draft.variableId),
            );
          }}
        />
      </div>
      <div className="timeline__controls">
        <div className="timeline__panel-body">
          <div
            className="timeline__fields"
            role="group"
            aria-label={t("layout.timeframe.label")}
          >
            <YearField
              field="start"
              year={range.start}
              onYear={(year) => {
                setRange(
                  commitYear(data, range, "start", year, draft.variableId),
                );
              }}
            />
            <span className="timeline__arrow" aria-hidden="true">
              →
            </span>
            <YearField
              field="end"
              year={range.end}
              onYear={(year) => {
                setRange(
                  commitYear(data, range, "end", year, draft.variableId),
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
