import { StatusBanner } from "../../components/ui/StatusBanner";
import { t, type MessageKey } from "../../i18n";
import {
  formatInterval,
  formatPValue,
  formatSigned,
  formatYearRange,
} from "../../lib/format";
import type { SeriesResult, TrendResult } from "../compare/contract";
import { trendDirection } from "./chartHighlights";
import { SHORT_PERIOD_FLAG, areaMeanNote, unitLabel } from "./TrendSummary";

type Status = TrendResult["significance_status"];

/** Verdict box text; follows the API classification, so it always agrees with the assessment. */
const VERDICT_LABEL: Record<Status, MessageKey> = {
  positive_trend: "result.verdict.positive_trend",
  negative_trend: "result.verdict.negative_trend",
  no_clear_trend: "result.verdict.no_clear_trend",
};

const ASSESSMENT_LABEL: Record<Status, MessageKey> = {
  positive_trend: "result.assessment.positive_trend",
  negative_trend: "result.assessment.negative_trend",
  no_clear_trend: "trend.significance.no_clear_trend",
};

/**
 * Trend result of one place in the city result card (E-67): verdict box, then trend per decade,
 * 95% CI, assessment, years used, p-value and period (E-70). All values come from the API; only
 * formatting happens here.
 */
export function TrendVerdict({
  series,
  unit,
}: {
  series: SeriesResult;
  /** Catalog unit of the analysed variable, e.g. "degC". */
  unit: string;
}) {
  const { trend, quality } = series;
  const unitText = unitLabel(unit);
  const note = areaMeanNote(series.provenance.spatial_method);
  return (
    <div className="trend-verdict" data-testid="trend-verdict">
      {quality.baseline_status === "missing_baseline" && (
        <StatusBanner tone="warning">{t("trend.missingBaseline")}</StatusBanner>
      )}
      {trend === null || quality.status === "insufficient_data" ? (
        <StatusBanner tone="warning">
          {t("trend.insufficientData")}
        </StatusBanner>
      ) : (
        <>
          <p
            className="trend-verdict__box"
            data-status={trend.significance_status}
          >
            {t(VERDICT_LABEL[trend.significance_status])}
          </p>
          <dl className="trend-verdict__values">
            {/* UI-DESIGN-10: the trend per decade as the headline figure; arrow and colour follow
                the API's sign and significance_status, the text keeps the sign. */}
            <div
              className="trend-hero"
              data-direction={trendDirection(trend.slope_per_decade)}
              data-status={trend.significance_status}
            >
              <dt>{t("trend.slope")}</dt>
              <dd>{`${formatSigned(trend.slope_per_decade)} ${unitText} ${t("trend.perDecade")}`}</dd>
            </div>
            <div>
              <dt>{t("trend.ci95")}</dt>
              <dd>{`${formatInterval(trend.ci95_low, trend.ci95_high)} ${unitText} ${t("trend.perDecade")}`}</dd>
            </div>
            <div>
              <dt>
                {t("trend.significance")}
                {trend.significance_status !== "no_clear_trend" && (
                  <span className="trend-verdict__hint">
                    {t("result.assessment.hint")}
                  </span>
                )}
              </dt>
              <dd>{t(ASSESSMENT_LABEL[trend.significance_status])}</dd>
            </div>
            <div>
              <dt>{t("trend.years")}</dt>
              <dd>{trend.n_years}</dd>
            </div>
            <div>
              <dt>{t("trend.pValue")}</dt>
              <dd>{formatPValue(trend.p_value)}</dd>
            </div>
            <div>
              <dt>{t("trend.period")}</dt>
              <dd>{formatYearRange(trend.start_year, trend.end_year)}</dd>
            </div>
          </dl>
        </>
      )}
      {note !== null && (
        <p className="trend-verdict__note" role="note">
          {note}
        </p>
      )}
      {trend?.diagnostic_flags.includes(SHORT_PERIOD_FLAG) === true && (
        <p className="trend-verdict__note" role="note">
          {t("trend.shortPeriod")}
        </p>
      )}
    </div>
  );
}
