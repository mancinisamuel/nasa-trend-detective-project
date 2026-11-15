import { useId } from "react";

import { PinIcon } from "../../components/ui/PinIcon";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { apiUserMessage } from "../../lib/apiClient";
import { t, tf } from "../../i18n";
import { TrendVerdict } from "../evidence/TrendVerdict";
import { buildCompareRequest } from "./compareRequest";
import { sameSelection, useCompareSelection } from "./CompareSelection";
import { samePlace } from "./mapSelection";
import { useStaleNotice } from "./staleNotice";
import { useCompare } from "./useCompare";

/**
 * Result card of a selected municipality, district or county (E-67). Before CALCULATE it sits below
 * the region list with a "Calculate for <place>" button (UI-DESIGN-7); once calculated it stands
 * alone at the top with "Change location", which brings the state's list back. Values come from the same compare
 * query as the results chart (no extra request), and only once CALCULATE ran for this place.
 */
export function CityResultCard({
  name,
  onChangeLocation,
  onClear,
}: {
  name: string;
  onChangeLocation: () => void;
  /** UI-DESIGN-8: X in the place line before CALCULATE; removes the selection. */
  onClear?: () => void;
}) {
  const headingId = useId();
  const { catalog, draft, applied, apply } = useCompareSelection();
  const calculated =
    catalog.data !== undefined &&
    draft !== null &&
    applied !== null &&
    samePlace(draft.place, applied.place);
  const request = calculated
    ? buildCompareRequest(
        catalog.data,
        applied.variableId,
        applied.place,
        applied.range,
      )
    : null;
  const compare = useCompare(request);
  const result = compare.data;
  const unit =
    catalog.data?.variables.find(
      (item) => item.id === result?.request.variable_id,
    )?.unit ?? "";
  const stale =
    result !== undefined &&
    draft !== null &&
    applied !== null &&
    (result.cache_status === "stale" || !sameSelection(draft, applied));
  // UI-DESIGN-4: the stale hint is a toast at the bottom edge, not a banner in the panel.
  useStaleNotice(stale);
  // UI-DESIGN-7: CALCULATE lives here (no longer in the timeline); same apply as before, so the
  // period comes from the timeline. Shown before the first calculation for this place and again
  // while the selection differs from the calculated one (e.g. a new period).
  const needsCalculate = !calculated || !sameSelection(draft, applied);
  // UI-DESIGN-15: already calculated for this place, only the period (or variable) changed: the
  // same apply, but orange and "Recalculate for <place>".
  const recalculate = calculated && needsCalculate;
  return (
    <aside
      // UI-DESIGN-3: once calculated, the place line shrinks and "Change location" sits right.
      className={`result-card${calculated ? " result-card--calculated" : ""}`}
      data-testid="city-result-card"
      aria-labelledby={headingId}
      aria-busy={compare.isFetching}
    >
      <div className="result-card__head">
        <h2 id={headingId} className="result-card__title">
          <PinIcon className="result-card__pin" />
          <span className="result-card__name" title={name}>
            {name}
          </span>
        </h2>
        {calculated && (
          <button
            type="button"
            className="result-card__change"
            onClick={onChangeLocation}
          >
            {t("result.changeLocation")}
          </button>
        )}
        {!calculated && onClear !== undefined && (
          <button
            type="button"
            className="result-card__clear"
            aria-label={t("toast.close")}
            onClick={onClear}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="result-card__body">
        {needsCalculate && (
          <button
            type="button"
            className={`result-card__calculate${recalculate ? " result-card__calculate--recalculate" : ""}`}
            onClick={apply}
          >
            {tf(recalculate ? "result.recalculateFor" : "result.calculateFor", {
              name,
            })}
          </button>
        )}
        {compare.isFetching && (
          <StatusBanner tone="info">{t("compare.loading")}</StatusBanner>
        )}
        {compare.isError && (
          <StatusBanner tone="error">
            {apiUserMessage(compare.error, t("compare.error"))}
          </StatusBanner>
        )}
        {result?.series.map((entry) => (
          <TrendVerdict key={entry.location.id} series={entry} unit={unit} />
        ))}
      </div>
    </aside>
  );
}
