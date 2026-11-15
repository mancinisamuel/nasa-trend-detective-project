import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { t } from "../../i18n";
import { ApiRequestError, apiUserMessage } from "../../lib/apiClient";
import { SeriesChart } from "../evidence/SeriesChart";
import {
  buildExtremesQuery,
  isExtremesUnsupported,
} from "../extremes/extremesRequest";
import {
  isMetricId,
  METRIC_GROUPS,
  METRIC_LABEL,
  thresholdSubtitle,
  type MetricId,
} from "../extremes/metrics";
import { useExtremes } from "../extremes/useExtremes";
import { buildCompareExport, buildExtremesExport } from "./buildExport";
import { collectExcelReportInput, loadedCompares } from "./buildExcelReport";
import { buildCompareRequest } from "./compareRequest";
import { ExportActions } from "./ExportActions";
import {
  samePlaceAndRange,
  sameSelection,
  useCompareSelection,
  type ChartView,
  type Selection,
} from "./CompareSelection";
import type { CatalogResponse, CompareResponse } from "./contract";
import type { Place } from "./mapSelection";
import { isOfferedVariable, isUnknownVariableError } from "./offeredVariables";
import { useStaleNotice } from "./staleNotice";
import { useCompare } from "./useCompare";

function isCompareResponse(value: unknown): value is CompareResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    "series" in value
  );
}

function isRetryable(error: Error): boolean {
  return error instanceof ApiRequestError ? error.retryable : true;
}

function RetryableError({
  error,
  onRetry,
  message,
  retryLabel,
}: {
  error: Error;
  onRetry: () => void;
  message: string;
  retryLabel: string;
}) {
  return (
    <div className="compare-sheet__error">
      <StatusBanner tone="error">{message}</StatusBanner>
      {isRetryable(error) && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** What the info button shows: the former chart title, subtitle and caveat (UI-DESIGN-3). */
type ChartInfoContent = {
  titles: readonly string[];
  subtitle?: string | undefined;
  note?: string | undefined;
};

/**
 * Round "i" next to the variable select. Hover or keyboard focus shows a tooltip with the chart's
 * title, definition and caveat; Esc closes it.
 */
function ChartInfo({ titles, subtitle, note }: ChartInfoContent) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  // Capture phase, so Esc closes the tooltip without also taking the globe one level back.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  if (titles.length === 0 && subtitle === undefined && note === undefined) {
    return null;
  }
  return (
    <div
      className="chart-info"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="chart-info__button"
        aria-label={t("chart.info")}
        aria-describedby={tooltipId}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M12 11v6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className="chart-info__tooltip"
        data-testid="chart-info-tooltip"
        hidden={!open}
      >
        {titles.map((title) => (
          <p key={title} className="chart-info__title">
            {title}
          </p>
        ))}
        {subtitle !== undefined && (
          <p className="chart-info__subtitle">{subtitle}</p>
        )}
        {note !== undefined && <p className="chart-info__note">{note}</p>}
      </div>
    </div>
  );
}

function placeLabel(catalog: CatalogResponse, place: Place): string {
  if (place.kind === "point") return place.label;
  return (
    catalog.locations.find((item) => item.id === place.id)?.label ?? place.id
  );
}

/**
 * Content of the bottom sheet (E-30): the variable, then the chart of POST /api/v1/compare for the
 * applied selection. The period comes from the timeline on the main screen; the location only from
 * map, side panel and search (E-69). All numbers come from the API.
 */
export function CompareSheet() {
  const { catalog, draft, applied, chartView, setVariable, setChartView } =
    useCompareSelection();
  if (catalog.isPending) {
    return (
      <div className="compare-sheet">
        <StatusBanner tone="info">{t("compare.loading")}</StatusBanner>
      </div>
    );
  }
  if (catalog.isError) {
    return (
      <div className="compare-sheet">
        <RetryableError
          error={catalog.error}
          onRetry={() => {
            void catalog.refetch();
          }}
          message={apiUserMessage(catalog.error, t("compare.error"))}
          retryLabel={t("compare.retry")}
        />
      </div>
    );
  }
  if (draft === null || applied === null) return null;
  return (
    <CompareResult
      catalog={catalog.data}
      draft={draft}
      applied={applied}
      chartView={chartView}
      onChartViewChange={setChartView}
      onVariableChange={setVariable}
    />
  );
}

function CompareResult({
  catalog,
  draft,
  applied,
  chartView,
  onChartViewChange,
  onVariableChange,
}: {
  catalog: CatalogResponse;
  draft: Selection;
  applied: Selection;
  chartView: ChartView;
  onChartViewChange: (view: ChartView) => void;
  onVariableChange: (variableId: string) => void;
}) {
  const request = buildCompareRequest(
    catalog,
    applied.variableId,
    applied.place,
    applied.range,
  );
  const compare = useCompare(request);
  const extremesUnsupported = isExtremesUnsupported(catalog, applied.place);
  const extremes = useExtremes(
    extremesUnsupported
      ? null
      : buildExtremesQuery(catalog, applied.place, applied.range),
  );

  const result = compare.data;
  const dataMode =
    chartView.kind === "extreme"
      ? (extremes.data?.data_mode ?? catalog.data_mode)
      : (result?.data_mode ?? catalog.data_mode);
  const unit =
    catalog.variables.find((v) => v.id === result?.request.variable_id)?.unit ??
    "";
  const showStale =
    chartView.kind === "extreme"
      ? !samePlaceAndRange(draft, applied)
      : result !== undefined &&
        (result.cache_status === "stale" || !sameSelection(draft, applied));

  const unknownIds = new Set<string>();
  if (
    chartView.kind === "variable" &&
    compare.isError &&
    isUnknownVariableError(compare.error)
  ) {
    unknownIds.add(applied.variableId);
  }
  const monthlyGroup = t("compare.group.monthly");
  const variableOptions = [
    ...catalog.variables
      .filter((v) => isOfferedVariable(v, catalog.data_mode, unknownIds))
      .map((v) => ({
        value: v.id,
        label: v.label,
        group: monthlyGroup,
      })),
    ...METRIC_GROUPS.flatMap((group) =>
      group.metrics.map((id) => ({
        value: id,
        label: t(METRIC_LABEL[id]),
        group: t(group.id),
      })),
    ),
  ];
  // UI-DESIGN-4: the stale hint is a toast at the bottom edge, not a banner at the chart.
  useStaleNotice(showStale);
  const variableValue =
    chartView.kind === "extreme" ? chartView.id : draft.variableId;
  const activeFetching =
    chartView.kind === "extreme" ? extremes.isFetching : compare.isFetching;
  const queryClient = useQueryClient();
  const locationName = placeLabel(catalog, applied.place);
  const variableLabel =
    catalog.variables.find((v) => v.id === result?.request.variable_id)
      ?.label ?? "";
  const info: ChartInfoContent =
    chartView.kind === "extreme"
      ? {
          titles: [`${t(METRIC_LABEL[chartView.id])} · ${locationName}`],
          subtitle:
            extremes.data === undefined
              ? undefined
              : thresholdSubtitle(chartView.id, extremes.data.thresholds),
          note: t("extremes.note"),
        }
      : {
          titles:
            result?.series.map(
              (entry) => `${variableLabel} · ${entry.location.label}`,
            ) ?? [],
        };
  const retrievedAtFallback = new Date().toISOString();
  const exportPayload =
    chartView.kind === "extreme"
      ? extremes.data === undefined
        ? null
        : buildExtremesExport(
            extremes.data,
            chartView.id,
            locationName,
            retrievedAtFallback,
          )
      : result === undefined
        ? null
        : buildCompareExport(result, unit, retrievedAtFallback);

  return (
    <div className="compare-sheet" aria-busy={activeFetching}>
      {dataMode === "demo" && (
        <StatusBanner tone="info">{t("compare.demoBanner")}</StatusBanner>
      )}
      <div className="compare-sheet__result" data-testid="compare-sheet-result">
        {/* UI-DESIGN-3: variable select and info button lie over the chart's top left corner; the
            label stays for screen readers only, title and caveat moved into the tooltip. The
            export menu (UI-XLSX) sits at the right end of the same bar. */}
        <div className="chart-tools">
          <Select
            label={t("compare.variable")}
            value={variableValue}
            options={variableOptions}
            onChange={(event) => {
              const value = event.target.value;
              if (isMetricId(value)) {
                onChartViewChange({ kind: "extreme", id: value });
                return;
              }
              onChartViewChange({ kind: "variable" });
              onVariableChange(value);
            }}
          />
          <ChartInfo {...info} />
          {exportPayload !== null && (
            <ExportActions
              payload={exportPayload}
              buildExcelInput={() => {
                const cached = queryClient
                  .getQueriesData({ queryKey: ["compare"] })
                  .map(([, data]) => data)
                  .filter(isCompareResponse);
                return collectExcelReportInput({
                  catalog,
                  applied,
                  locationLabel: locationName,
                  compares: loadedCompares(cached, applied, result),
                  extremes: extremes.data,
                  retrievedAtFallback: new Date().toISOString(),
                });
              }}
            />
          )}
        </div>
        {chartView.kind === "variable" ? (
          <CompareChart compare={compare} unit={unit} catalog={catalog} />
        ) : (
          <ExtremesChart
            extremes={extremes}
            metricId={chartView.id}
            locationName={locationName}
            unsupported={extremesUnsupported}
          />
        )}
      </div>
    </div>
  );
}

function CompareChart({
  compare,
  unit,
  catalog,
}: {
  compare: ReturnType<typeof useCompare>;
  unit: string;
  catalog: CatalogResponse;
}) {
  const result = compare.data;
  const unknownVariable =
    compare.isError && isUnknownVariableError(compare.error);
  return (
    <>
      {compare.isFetching && (
        <StatusBanner tone="info">{t("compare.loading")}</StatusBanner>
      )}
      {compare.isError && !unknownVariable && (
        <RetryableError
          error={compare.error}
          onRetry={() => {
            void compare.refetch();
          }}
          message={apiUserMessage(compare.error, t("compare.error"))}
          retryLabel={t("compare.retry")}
        />
      )}
      {result?.series.map((entry) => (
        <SeriesChart
          key={entry.location.id}
          observations={entry.observations_annual}
          trendLine={entry.trend?.trend_line}
          title={`${
            catalog.variables.find((v) => v.id === result.request.variable_id)
              ?.label ?? ""
          } · ${entry.location.label}`}
          unit={unit}
        />
      ))}
    </>
  );
}

function ExtremesChart({
  extremes,
  metricId,
  locationName,
  unsupported,
}: {
  extremes: ReturnType<typeof useExtremes>;
  metricId: MetricId;
  locationName: string;
  unsupported: boolean;
}) {
  const metric = extremes.data?.metrics[metricId];
  if (unsupported) {
    return (
      <p className="extremes__note" role="note">
        {t("extremes.regionUnsupported")}
      </p>
    );
  }
  return (
    <>
      {extremes.isFetching && (
        <StatusBanner tone="info">{t("extremes.loading")}</StatusBanner>
      )}
      {extremes.isError && (
        <RetryableError
          error={extremes.error}
          onRetry={() => {
            void extremes.refetch();
          }}
          message={apiUserMessage(extremes.error, t("extremes.error"))}
          retryLabel={t("extremes.retry")}
        />
      )}
      {extremes.data !== undefined && metric !== undefined && (
        <SeriesChart
          observations={metric.series}
          trendLine={metric.trend?.trend_line}
          title={`${t(METRIC_LABEL[metricId])} · ${locationName}`}
          subtitle={thresholdSubtitle(metricId, extremes.data.thresholds)}
          unit={metric.unit}
        />
      )}
    </>
  );
}
