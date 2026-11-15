import type {
  ExtremeMetric,
  ExtremesResponse,
  TrendResult,
} from "../src/features/compare/contract";

const trend: TrendResult = {
  method: "ols_hac",
  method_version: "ols-hac-nw3-v1",
  n_years: 45,
  start_year: 1981,
  end_year: 2025,
  slope_per_decade: 3.44,
  ci95_low: 2.1,
  ci95_high: 4.8,
  p_value: 0.000003,
  significance_status: "positive_trend",
  diagnostic_flags: [],
  trend_line: [
    { year: 1981, value: 8 },
    { year: 2025, value: 23 },
  ],
};

export function extremeMetric(
  overrides: Partial<ExtremeMetric> = {},
): ExtremeMetric {
  return {
    parameter: "T2M_MAX",
    unit: "days",
    series: [],
    trend: null,
    ...overrides,
  };
}

const provenance: ExtremesResponse["provenance"] = {
  provider: "demo",
  dataset: "demo",
  parameter: "T2M_MAX",
  community: "RE",
  requested_coordinates: { latitude: 48.21, longitude: 16.37 },
  returned_coordinates: null,
  retrieved_at: "2026-11-15T08:00:00Z",
  source_url: null,
  raw_sha256: "0",
  provider_version: null,
};

/** Minimal valid payload so other sheet tests are not blocked by a 404. */
export function minimalExtremes(
  overrides: Partial<ExtremesResponse> = {},
): ExtremesResponse {
  const empty = extremeMetric();
  return {
    schema_version: "1.0",
    analysis_version: "extremes-v1",
    request_id: "e",
    data_mode: "demo",
    cache_status: "miss",
    generated_at: "2026-11-15T08:00:00Z",
    coordinates: { latitude: 48.21, longitude: 16.37 },
    start_year: 1981,
    end_year: 2025,
    data_end: null,
    thresholds: {
      hot_day_tmax_c: 30,
      tropical_night_tmin_c: 20,
      frost_day_tmin_c: 0,
      ice_day_tmax_c: 0,
      wet_day_mm: 1,
      heavy_rain_mm: 20,
      dry_day_below_mm: 1,
      radiation_from_year: 1984,
    },
    metrics: {
      hot_days: empty,
      tropical_nights: empty,
      longest_heatwave: empty,
      hottest_day: extremeMetric({ parameter: "T2M_MAX", unit: "degC" }),
      frost_days: empty,
      ice_days: empty,
      wettest_day: extremeMetric({ parameter: "PRECTOTCORR", unit: "mm/day" }),
      wet_days: empty,
      heavy_rain_days: empty,
      longest_dry_spell: empty,
      max_hourly_wind: extremeMetric({ parameter: "WS10M_MAX", unit: "m/s" }),
      radiation_sum: extremeMetric({
        parameter: "ALLSKY_SFC_SW_DWN",
        unit: "MJ/m^2",
      }),
    },
    provenance,
    ...overrides,
  };
}

/** Vienna-like fixture for the Extremes section tests (UI-EXTREMES). */
export function viennaExtremes(): ExtremesResponse {
  return minimalExtremes({
    data_mode: "live",
    cache_status: "fresh",
    data_end: "2025-12-31",
    metrics: {
      ...minimalExtremes().metrics,
      hot_days: extremeMetric({
        series: [
          { year: 1981, value: 8, date: null },
          { year: 2013, value: 20, date: null },
          { year: 2025, value: 24, date: null },
        ],
        trend,
      }),
      hottest_day: extremeMetric({
        parameter: "T2M_MAX",
        unit: "degC",
        series: [
          { year: 1981, value: 32.2, date: "1981-08-02" },
          { year: 2013, value: 38.53, date: "2013-08-08" },
          { year: 2024, value: 36.1, date: "2024-07-10" },
        ],
        trend: { ...trend, slope_per_decade: 0.58, p_value: 0.000003 },
      }),
      wettest_day: extremeMetric({
        parameter: "PRECTOTCORR",
        unit: "mm/day",
        series: [
          { year: 1981, value: 22.11, date: "1981-10-22" },
          { year: 2024, value: 54.78, date: "2024-09-14" },
        ],
        trend: { ...trend, slope_per_decade: 2.89, p_value: 0.004 },
      }),
      heavy_rain_days: extremeMetric({
        parameter: "PRECTOTCORR",
        unit: "days",
        series: [
          { year: 1981, value: 2, date: null },
          { year: 2024, value: 5, date: null },
        ],
        trend: { ...trend, slope_per_decade: 0.76, p_value: 0.0000005 },
      }),
      max_hourly_wind: extremeMetric({
        parameter: "WS10M_MAX",
        unit: "m/s",
        series: [
          { year: 1981, value: 14.24, date: "1981-10-11" },
          { year: 2020, value: 17.85, date: "2020-02-04" },
        ],
        trend: { ...trend, slope_per_decade: 0.16, p_value: 0.197 },
      }),
    },
  });
}

export function isExtremesUrl(url: string): boolean {
  return url.startsWith("/api/v1/extremes");
}
