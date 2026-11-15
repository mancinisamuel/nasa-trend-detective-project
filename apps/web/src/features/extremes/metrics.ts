import { t, type MessageKey } from "../../i18n";
import type { ExtremeThresholds, ExtremeYearValue } from "../compare/contract";

export const METRIC_IDS = [
  "hot_days",
  "tropical_nights",
  "longest_heatwave",
  "hottest_day",
  "frost_days",
  "ice_days",
  "wettest_day",
  "wet_days",
  "heavy_rain_days",
  "longest_dry_spell",
  "max_hourly_wind",
  "radiation_sum",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export const METRIC_GROUPS: { id: MessageKey; metrics: readonly MetricId[] }[] =
  [
    {
      id: "extremes.group.heat",
      metrics: [
        "hot_days",
        "tropical_nights",
        "longest_heatwave",
        "hottest_day",
      ],
    },
    { id: "extremes.group.cold", metrics: ["frost_days", "ice_days"] },
    {
      id: "extremes.group.precipitation",
      metrics: [
        "wettest_day",
        "wet_days",
        "heavy_rain_days",
        "longest_dry_spell",
      ],
    },
    { id: "extremes.group.wind", metrics: ["max_hourly_wind"] },
    { id: "extremes.group.sun", metrics: ["radiation_sum"] },
  ];

export const RECORD_IDS = [
  "hottest_day",
  "wettest_day",
  "max_hourly_wind",
] as const satisfies readonly MetricId[];

export const METRIC_LABEL: Record<MetricId, MessageKey> = {
  hot_days: "extremes.metric.hot_days",
  tropical_nights: "extremes.metric.tropical_nights",
  longest_heatwave: "extremes.metric.longest_heatwave",
  hottest_day: "extremes.metric.hottest_day",
  frost_days: "extremes.metric.frost_days",
  ice_days: "extremes.metric.ice_days",
  wettest_day: "extremes.metric.wettest_day",
  wet_days: "extremes.metric.wet_days",
  heavy_rain_days: "extremes.metric.heavy_rain_days",
  longest_dry_spell: "extremes.metric.longest_dry_spell",
  max_hourly_wind: "extremes.metric.max_hourly_wind",
  radiation_sum: "extremes.metric.radiation_sum",
};

export const RECORD_LABEL: Record<(typeof RECORD_IDS)[number], MessageKey> = {
  hottest_day: "extremes.record.hottest_day",
  wettest_day: "extremes.record.wettest_day",
  max_hourly_wind: "extremes.record.max_hourly_wind",
};

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

export function unitLabel(unit: string): string {
  const key = UNIT_KEYS[unit];
  return key === undefined ? unit : t(key);
}

export function isMetricId(value: string): value is MetricId {
  return (METRIC_IDS as readonly string[]).includes(value);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    value,
  );
}

/**
 * Picks the series entry with the highest non-null value (a selection, not a
 * statistic). The API has no separate record field. Ties keep the earlier year.
 */
export function recordEntry(
  series: ExtremeYearValue[],
): ExtremeYearValue | null {
  let best: ExtremeYearValue | null = null;
  for (const entry of series) {
    if (entry.value === null) continue;
    if (best === null || best.value === null || entry.value > best.value) {
      best = entry;
    }
  }
  return best;
}

export function thresholdSubtitle(
  metricId: MetricId,
  thresholds: ExtremeThresholds,
): string | undefined {
  switch (metricId) {
    case "hot_days":
    case "longest_heatwave":
      return `${t("extremes.threshold.hot_day")} ${formatQuantity(thresholds.hot_day_tmax_c)} ${t("unit.degC")}`;
    case "tropical_nights":
      return `${t("extremes.threshold.tropical_night")} ${formatQuantity(thresholds.tropical_night_tmin_c)} ${t("unit.degC")}`;
    case "frost_days":
      return `${t("extremes.threshold.frost_day")} ${formatQuantity(thresholds.frost_day_tmin_c)} ${t("unit.degC")}`;
    case "ice_days":
      return `${t("extremes.threshold.ice_day")} ${formatQuantity(thresholds.ice_day_tmax_c)} ${t("unit.degC")}`;
    case "wet_days":
      return `${t("extremes.threshold.wet_day")} ${formatQuantity(thresholds.wet_day_mm)} ${t("unit.mm")}`;
    case "heavy_rain_days":
      return `${t("extremes.threshold.heavy_rain")} ${formatQuantity(thresholds.heavy_rain_mm)} ${t("unit.mm")}`;
    case "longest_dry_spell":
      return `${t("extremes.threshold.dry_day")} ${formatQuantity(thresholds.dry_day_below_mm)} ${t("unit.mm")}`;
    case "radiation_sum":
      return `${t("extremes.threshold.radiation_from")} ${String(thresholds.radiation_from_year)}`;
    case "hottest_day":
    case "wettest_day":
    case "max_hourly_wind":
      return undefined;
  }
}
