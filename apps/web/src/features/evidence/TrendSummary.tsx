import { useId } from "react";

import { StatusBanner } from "../../components/ui/StatusBanner";
import { t, type MessageKey } from "../../i18n";
import {
  formatInterval,
  formatPValue,
  formatSigned,
  formatYearRange,
} from "../../lib/format";
import type {
  Provenance,
  SeriesResult,
  TrendResult,
} from "../compare/contract";
import { SeriesMarker } from "./SeriesMarker";
import { trendDirection } from "./chartHighlights";

type TrendSummaryProps = {
  series: SeriesResult;
  /** Unit of the analysed variable (catalog entry of response.request.variable_id), e.g. "mm/year". */
  unit: string;
};

const SIGNIFICANCE_LABEL: Record<
  TrendResult["significance_status"],
  MessageKey
> = {
  positive_trend: "trend.significance.positive_trend",
  negative_trend: "trend.significance.negative_trend",
  no_clear_trend: "trend.significance.no_clear_trend",
};

/** Catalog units (variable.unit, a free string in the contract) mapped to their i18n keys. */
const UNIT_KEYS: Partial<Record<string, MessageKey>> = {
  degC: "unit.degC",
  "mm/year": "unit.mm_year",
  "mm/day": "unit.mm_day",
  mm: "unit.mm",
  "%": "unit.percent",
  "m/s": "unit.m_s",
  days: "unit.days",
  "MJ/m^2": "unit.mj_m2",
};

/** Display label of a catalog unit; an unknown unit is shown as the raw catalog value. */
export function unitLabel(unit: string): string {
  const key = UNIT_KEYS[unit];
  return key === undefined ? unit : t(key);
}

/** API flag (D-05) for a trend computed over a short period; the API decides, not the frontend. */
export const SHORT_PERIOD_FLAG = "short_period";

/**
 * Trend fields from the API (slope, CI, p, assessment, years). Missing fields are hidden;
 * the frontend does not compute replacements.
 */
type TrendView = Partial<
  Pick<
    TrendResult,
    | "slope_per_decade"
    | "ci95_low"
    | "ci95_high"
    | "p_value"
    | "significance_status"
    | "n_years"
    | "start_year"
    | "end_year"
    | "diagnostic_flags"
  >
>;

export function TrendFields({
  trend,
  unit,
}: {
  trend: TrendResult | null;
  unit: string;
}) {
  if (trend === null) {
    return (
      <StatusBanner tone="warning">{t("trend.insufficientData")}</StatusBanner>
    );
  }
  // Read through a partial view so missing API fields can be hidden at runtime.
  const view: TrendView = trend;
  const assessment =
    view.significance_status === undefined
      ? undefined
      : SIGNIFICANCE_LABEL[view.significance_status];
  return (
    <>
      <dl className="trend-summary__values">
        {typeof view.slope_per_decade === "number" && (
          <div
            className="trend-hero"
            data-direction={trendDirection(view.slope_per_decade)}
            data-status={view.significance_status}
          >
            <dt>{t("trend.slope")}</dt>
            <dd>{`${formatSigned(view.slope_per_decade)} ${unitLabel(unit)} ${t("trend.perDecade")}`}</dd>
          </div>
        )}
        {typeof view.ci95_low === "number" &&
          typeof view.ci95_high === "number" && (
            <div>
              <dt>{t("trend.ci95")}</dt>
              <dd>
                {`${formatInterval(view.ci95_low, view.ci95_high)} ${unitLabel(unit)} ${t("trend.perDecade")}`}
              </dd>
            </div>
          )}
        {typeof view.p_value === "number" && (
          <div>
            <dt>{t("trend.pValue")}</dt>
            <dd>{formatPValue(view.p_value)}</dd>
          </div>
        )}
        {assessment !== undefined && (
          <div>
            <dt>{t("trend.significance")}</dt>
            <dd>{t(assessment)}</dd>
          </div>
        )}
        {typeof view.n_years === "number" && (
          <div>
            <dt>{t("trend.years")}</dt>
            <dd>{view.n_years}</dd>
          </div>
        )}
        {typeof view.start_year === "number" &&
          typeof view.end_year === "number" && (
            <div>
              <dt>{t("trend.period")}</dt>
              <dd>{formatYearRange(view.start_year, view.end_year)}</dd>
            </div>
          )}
      </dl>
      {view.diagnostic_flags?.includes(SHORT_PERIOD_FLAG) && (
        <p className="trend-summary__note" role="note">
          {t("trend.shortPeriod")}
        </p>
      )}
    </>
  );
}

/** Area-mean caveat from API spatial_method only; a grid point or capital has no note. */
export function areaMeanNote(
  spatialMethod: Provenance["spatial_method"] | undefined,
): string | null {
  if (spatialMethod === "area_weighted_grid") return t("trend.areaMean.grid");
  if (spatialMethod === "area_weighted_states") {
    return t("trend.areaMean.states");
  }
  return null;
}

/** Trend result of the chosen location (E-30 bottom sheet). Shows no number without a trend. */
export function TrendSummary({ series, unit }: TrendSummaryProps) {
  const headingId = useId();
  const { trend, quality } = series;
  const note = areaMeanNote(series.provenance.spatial_method);
  return (
    <article
      className="trend-summary trend-summary--a"
      aria-labelledby={headingId}
      data-testid="trend-summary"
    >
      <h3 id={headingId} className="trend-summary__title">
        <SeriesMarker slot="a" />
        <span>{series.location.label}</span>
      </h3>
      {quality.baseline_status === "missing_baseline" && (
        <StatusBanner tone="warning">{t("trend.missingBaseline")}</StatusBanner>
      )}
      {trend === null || quality.status === "insufficient_data" ? (
        <StatusBanner tone="warning">
          {t("trend.insufficientData")}
        </StatusBanner>
      ) : (
        <TrendFields trend={trend} unit={unit} />
      )}
      {note !== null && (
        <p className="trend-summary__note" role="note">
          {note}
        </p>
      )}
    </article>
  );
}
