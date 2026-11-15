import { isMetricId } from "../extremes/metrics";
import { t } from "../../i18n";
import type { CompareResponse, ExtremesResponse, Provenance } from "./contract";

export const EXPORT_SOURCE = "NASA POWER";

export type SpatialMethod = Provenance["spatial_method"];
export type CellCount = Provenance["cell_count"];

/** Human-readable spatial provenance from API fields only. t() has no interpolation. */
export function formatSpatialMethodLabel(
  spatialMethod: SpatialMethod,
  cellCount: CellCount,
): string | null {
  if (spatialMethod === "area_weighted_grid") {
    if (typeof cellCount !== "number") return null;
    return t("export.spatial.areaWeightedGrid").replaceAll(
      "{count}",
      String(cellCount),
    );
  }
  if (spatialMethod === "area_weighted_states") {
    return t("export.spatial.areaWeightedStates");
  }
  if (spatialMethod === "capital_point") {
    return t("export.spatial.capitalPoint");
  }
  if (spatialMethod === null) {
    return t("export.spatial.gridPoint");
  }
  return null;
}

/** Prefer primary provenance fields; fall back to another response (e.g. extremes). */
export function spatialFromProvenance(
  primary:
    | { spatial_method?: SpatialMethod; cell_count?: CellCount }
    | null
    | undefined,
  fallback?: { spatial_method?: SpatialMethod; cell_count?: CellCount } | null,
): { spatialMethod: SpatialMethod; cellCount: CellCount } {
  return {
    spatialMethod:
      primary?.spatial_method !== undefined
        ? primary.spatial_method
        : fallback?.spatial_method,
    cellCount:
      primary?.cell_count !== undefined
        ? primary.cell_count
        : fallback?.cell_count,
  };
}

export type ExportAnnualValue = {
  year: number;
  value: number | null;
};

/** Fields written into the JSON and CSV downloads of the shown series. */
export type ExportPayload = {
  locationLabel: string;
  latitude: number;
  longitude: number;
  startYear: number;
  endYear: number;
  variableId: string;
  unit: string;
  annualValues: ExportAnnualValue[];
  slopePerDecade: number | null;
  ci95Low: number | null;
  ci95High: number | null;
  pValue: number | null;
  analysisVersion?: string;
  source: typeof EXPORT_SOURCE;
  retrievedAt: string;
  spatialMethod?: SpatialMethod;
  cellCount?: CellCount;
  capitalName?: string | null;
};

export type ExportJson = {
  location: { label: string; latitude: number; longitude: number };
  period: { start_year: number; end_year: number };
  variable: string;
  unit: string;
  annual_values: ExportAnnualValue[];
  trend?: {
    slope_per_decade?: number;
    ci95_low?: number;
    ci95_high?: number;
    p_value?: number;
  };
  analysis_version?: string;
  source: typeof EXPORT_SOURCE;
  retrieved_at: string;
  spatial_method?: SpatialMethod;
  cell_count?: CellCount;
  capital_name?: string | null;
};

export function buildCompareExport(
  result: CompareResponse,
  unit: string,
  retrievedAtFallback: string,
): ExportPayload | null {
  const entry = result.series[0];
  if (entry === undefined) return null;
  const trend = entry.trend;
  return {
    locationLabel: entry.location.label,
    latitude: entry.location.latitude,
    longitude: entry.location.longitude,
    startYear: result.request.start_year,
    endYear: result.request.end_year,
    variableId: result.request.variable_id,
    unit,
    annualValues: entry.observations_annual.map((row) => ({
      year: row.year,
      value: row.value,
    })),
    slopePerDecade: trend?.slope_per_decade ?? null,
    ci95Low: trend?.ci95_low ?? null,
    ci95High: trend?.ci95_high ?? null,
    pValue: trend?.p_value ?? null,
    analysisVersion: blankToUndefined(result.analysis_version),
    source: EXPORT_SOURCE,
    retrievedAt: entry.provenance.retrieved_at || retrievedAtFallback,
    spatialMethod: entry.provenance.spatial_method,
    cellCount: entry.provenance.cell_count,
  };
}

export function buildExtremesExport(
  result: ExtremesResponse,
  metricId: string,
  locationLabel: string,
  retrievedAtFallback: string,
): ExportPayload | null {
  if (!isMetricId(metricId)) return null;
  const metric = result.metrics[metricId];
  const trend = metric.trend;
  return {
    locationLabel,
    latitude: result.coordinates.latitude,
    longitude: result.coordinates.longitude,
    startYear: result.start_year,
    endYear: result.end_year,
    variableId: metricId,
    unit: metric.unit,
    annualValues: metric.series.map((row) => ({
      year: row.year,
      value: row.value,
    })),
    slopePerDecade: trend?.slope_per_decade ?? null,
    ci95Low: trend?.ci95_low ?? null,
    ci95High: trend?.ci95_high ?? null,
    pValue: trend?.p_value ?? null,
    analysisVersion: blankToUndefined(result.analysis_version),
    source: EXPORT_SOURCE,
    retrievedAt: result.provenance.retrieved_at || retrievedAtFallback,
    spatialMethod: result.provenance.spatial_method,
    cellCount: result.provenance.cell_count,
    capitalName: result.provenance.capital_name,
  };
}

export function toExportJson(payload: ExportPayload): ExportJson {
  const trend: ExportJson["trend"] = {};
  if (payload.slopePerDecade !== null) {
    trend.slope_per_decade = payload.slopePerDecade;
  }
  if (payload.ci95Low !== null) trend.ci95_low = payload.ci95Low;
  if (payload.ci95High !== null) trend.ci95_high = payload.ci95High;
  if (payload.pValue !== null) trend.p_value = payload.pValue;
  const json: ExportJson = {
    location: {
      label: payload.locationLabel,
      latitude: payload.latitude,
      longitude: payload.longitude,
    },
    period: { start_year: payload.startYear, end_year: payload.endYear },
    variable: payload.variableId,
    unit: payload.unit,
    annual_values: payload.annualValues,
    source: payload.source,
    retrieved_at: payload.retrievedAt,
  };
  if (Object.keys(trend).length > 0) json.trend = trend;
  if (payload.analysisVersion !== undefined) {
    json.analysis_version = payload.analysisVersion;
  }
  if (payload.spatialMethod !== undefined) {
    json.spatial_method = payload.spatialMethod;
  }
  if (payload.cellCount !== undefined) {
    json.cell_count = payload.cellCount;
  }
  if (payload.capitalName !== undefined) {
    json.capital_name = payload.capitalName;
  }
  return json;
}

export function buildExportJson(payload: ExportPayload): string {
  return `${JSON.stringify(toExportJson(payload), null, 2)}\n`;
}

/** UTF-8 BOM + CRLF rows so Excel opens the file cleanly. */
export function buildExportCsv(payload: ExportPayload): string {
  const meta: [string, string | number][] = [
    ["location", payload.locationLabel],
    ["latitude", payload.latitude],
    ["longitude", payload.longitude],
    ["start_year", payload.startYear],
    ["end_year", payload.endYear],
    ["variable", payload.variableId],
    ["unit", payload.unit],
  ];
  if (payload.slopePerDecade !== null) {
    meta.push(["slope_per_decade", payload.slopePerDecade]);
  }
  if (payload.ci95Low !== null && payload.ci95High !== null) {
    meta.push(["ci95_low", payload.ci95Low], ["ci95_high", payload.ci95High]);
  }
  if (payload.pValue !== null) meta.push(["p_value", payload.pValue]);
  if (payload.analysisVersion !== undefined) {
    meta.push(["analysis_version", payload.analysisVersion]);
  }
  meta.push(["source", payload.source], ["retrieved_at", payload.retrievedAt]);
  if (payload.spatialMethod !== undefined) {
    meta.push(["spatial_method", payload.spatialMethod ?? ""]);
  }
  if (payload.cellCount !== undefined && payload.cellCount !== null) {
    meta.push(["cell_count", payload.cellCount]);
  }
  if (payload.capitalName !== undefined) {
    meta.push(["capital_name", payload.capitalName ?? ""]);
  }

  const lines = [
    csvRow(["key", "value"]),
    ...meta.map(([key, value]) => csvRow([key, value])),
    "",
    csvRow(["year", "value"]),
    ...payload.annualValues.map((row) =>
      csvRow([row.year, row.value === null ? "" : row.value]),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function exportFilename(
  payload: ExportPayload,
  extension: "csv" | "json" | "xlsx",
): string {
  const location = slug(payload.locationLabel);
  const variable = slug(payload.variableId);
  return `trend-detective_${location}_${variable}_${String(payload.startYear)}-${String(payload.endYear)}.${extension}`;
}

export function downloadTextFile(
  filename: string,
  text: string,
  mime: string,
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportWorkbookFilename(
  locationLabel: string,
  startYear: number,
  endYear: number,
): string {
  return `trend-detective_${slug(locationLabel)}_${String(startYear)}-${String(endYear)}.xlsx`;
}

export const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

function slug(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return safe === "" ? "export" : safe;
}

function csvRow(fields: readonly (string | number)[]): string {
  return fields.map(csvField).join(",");
}

function csvField(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
