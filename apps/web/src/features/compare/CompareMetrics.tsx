import { Button } from "../../components/ui/Button";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { t } from "../../i18n";
import { ApiRequestError, apiUserMessage } from "../../lib/apiClient";
import { TrendFields, TrendSummary } from "../evidence/TrendSummary";
import {
  buildExtremesQuery,
  isExtremesUnsupported,
} from "../extremes/extremesRequest";
import { ExtremesRecords } from "../extremes/ExtremesRecords";
import { METRIC_LABEL } from "../extremes/metrics";
import { useExtremes } from "../extremes/useExtremes";
import { buildCompareRequest } from "./compareRequest";
import { useCompareSelection } from "./CompareSelection";
import { useCompare } from "./useCompare";

function isRetryable(error: Error): boolean {
  return error instanceof ApiRequestError ? error.retryable : true;
}

/**
 * Trend figures for the selected series, plus permanent record tiles, in the
 * side panel (UI-ONECHART). Compare and extremes queries are shared with the chart.
 */
export function CompareMetrics({
  hideVariableTrend = false,
}: {
  /**
   * UI-DESIGN-6: true while the place card above already shows the trend verdict of the same
   * result; the variable trend block is then left out so the figures show only once.
   */
  hideVariableTrend?: boolean;
} = {}) {
  const { catalog, applied, chartView } = useCompareSelection();
  const request =
    catalog.data !== undefined && applied !== null
      ? buildCompareRequest(
          catalog.data,
          applied.variableId,
          applied.place,
          applied.range,
        )
      : null;
  const compare = useCompare(request);
  const extremesUnsupported =
    catalog.data !== undefined &&
    applied !== null &&
    isExtremesUnsupported(catalog.data, applied.place);
  const extremes = useExtremes(
    catalog.data !== undefined && applied !== null && !extremesUnsupported
      ? buildExtremesQuery(catalog.data, applied.place, applied.range)
      : null,
  );
  const result = compare.data;
  const unit =
    catalog.data?.variables.find(
      (item) => item.id === result?.request.variable_id,
    )?.unit ?? "";
  const extremeMetric =
    chartView.kind === "extreme"
      ? extremes.data?.metrics[chartView.id]
      : undefined;
  const hasTrend =
    (chartView.kind === "variable" &&
      !hideVariableTrend &&
      (compare.isLoading ||
        (result !== undefined && result.series.length > 0))) ||
    (chartView.kind === "extreme" &&
      !extremesUnsupported &&
      (extremes.isLoading || extremes.isError || extremeMetric !== undefined));
  const hasRecords =
    extremes.data !== undefined ||
    extremes.isError ||
    extremes.isLoading ||
    extremesUnsupported ||
    compare.isLoading;
  if (!hasTrend && !hasRecords) return null;

  return (
    <div className="compare-metrics" data-testid="compare-metrics">
      {hasTrend && (
        <div className="compare-metrics__trend">
          {chartView.kind === "variable" && compare.isLoading && (
            <StatusBanner tone="info">{t("compare.loading")}</StatusBanner>
          )}
          {chartView.kind === "variable" &&
            result?.series.map((entry) => (
              <TrendSummary
                key={entry.location.id}
                series={entry}
                unit={unit}
              />
            ))}
          {chartView.kind === "extreme" && extremes.isPending && (
            <StatusBanner tone="info">{t("extremes.loading")}</StatusBanner>
          )}
          {chartView.kind === "extreme" && extremes.isError && (
            <div className="compare-sheet__error">
              <StatusBanner tone="error">
                {apiUserMessage(extremes.error, t("extremes.error"))}
              </StatusBanner>
              {isRetryable(extremes.error) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void extremes.refetch();
                  }}
                >
                  {t("extremes.retry")}
                </Button>
              )}
            </div>
          )}
          {chartView.kind === "extreme" && extremeMetric !== undefined && (
            <article
              className="trend-summary trend-summary--a"
              data-testid="trend-summary"
            >
              <h3 className="trend-summary__title">
                {t(METRIC_LABEL[chartView.id])}
              </h3>
              <TrendFields
                trend={extremeMetric.trend}
                unit={extremeMetric.unit}
              />
            </article>
          )}
        </div>
      )}
      {extremesUnsupported && (
        <div
          className="compare-metrics__records"
          data-testid="extremes-region-unsupported"
        >
          <p className="extremes__note" role="note">
            {t("extremes.regionUnsupported")}
          </p>
        </div>
      )}
      {extremes.isLoading && (
        <div
          className="compare-metrics__records"
          data-testid="extremes-records-loading"
        >
          <StatusBanner tone="info">{t("extremes.loading")}</StatusBanner>
        </div>
      )}
      {extremes.data !== undefined && (
        <div className="compare-metrics__records">
          <ExtremesRecords
            metrics={extremes.data.metrics}
            provenance={extremes.data.provenance}
          />
        </div>
      )}
    </div>
  );
}
