import type ExcelJS from "exceljs";

import { t } from "../../i18n";
import { formatYearRange } from "../../lib/format";
import {
  METRIC_IDS,
  METRIC_LABEL,
  RECORD_IDS,
  RECORD_LABEL,
  recordEntry,
  thresholdSubtitle,
  unitLabel as extremeUnitLabel,
} from "../extremes/metrics";
import { unitLabel as catalogUnitLabel } from "../evidence/TrendSummary";
import type { Selection } from "./CompareSelection";
import {
  EXPORT_SOURCE,
  formatSpatialMethodLabel,
  spatialFromProvenance,
  type CellCount,
  type SpatialMethod,
} from "./buildExport";
import type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
  ExtremesResponse,
  LocationRef,
  PointRef,
  TrendResult,
} from "./contract";

const INK = "FF0B1A24";
const PAPER = "FFF4F7F8";
const ACCENT = "FF00646E";
const NUMBER_FORMAT = "0.00";
const P_FORMAT = "0.000E+00";
const COORD_FORMAT = "0.0000";
const CHART_COL = 4;
const CHART_ROW = 2;
const CHART_WIDTH = 900;
const CHART_HEIGHT = 420;

export type ExcelSeriesRow = {
  id: string;
  title: string;
  unit: string;
  observations: { year: number; value: number | null }[];
  trendLine: { year: number; value: number }[] | null;
  trend: TrendResult | null;
};

export type ExcelRecordRow = {
  label: string;
  value: number;
  unit: string;
  date: string | null;
};

export type ExcelThresholdRow = {
  label: string;
};

export type ExcelReportInput = {
  locationLabel: string;
  latitude: number;
  longitude: number;
  startYear: number;
  endYear: number;
  retrievedAt: string;
  spatialMethod?: SpatialMethod;
  cellCount?: CellCount;
  extremesSpatialMethod?: SpatialMethod;
  extremesCellCount?: CellCount;
  extremesCapitalName?: string | null;
  analysisVersion: string | null;
  methodDescription: string | null;
  minYears: number | null;
  hacLags: number | null;
  confidenceLevel: number | null;
  series: ExcelSeriesRow[];
  records: ExcelRecordRow[];
  thresholds: ExcelThresholdRow[];
  gridNote: string | null;
};

export type ExcelChartImages = {
  series: Record<string, string>;
  extremes?: string;
};

export function loadedCompares(
  cached: ReadonlyArray<CompareResponse | undefined>,
  applied: Selection,
  current?: CompareResponse,
): CompareResponse[] {
  const byVariable = new Map<string, CompareResponse>();
  for (const data of cached) {
    if (data === undefined) continue;
    if (!requestMatchesApplied(data.request, applied)) continue;
    byVariable.set(data.request.variable_id, data);
  }
  if (
    current !== undefined &&
    requestMatchesApplied(current.request, applied)
  ) {
    byVariable.set(current.request.variable_id, current);
  }
  return [...byVariable.values()];
}

export function requestMatchesApplied(
  request: CompareRequest,
  applied: Selection,
): boolean {
  if (
    request.start_year !== applied.range.start ||
    request.end_year !== applied.range.end
  ) {
    return false;
  }
  const loc = request.locations[0];
  if (loc === undefined) return false;
  if (applied.place.kind === "catalog") {
    return isLocationRef(loc) && loc.id === applied.place.id;
  }
  return (
    isPointRef(loc) &&
    loc.lat === applied.place.lat &&
    loc.lon === applied.place.lon
  );
}

export function collectExcelReportInput(args: {
  catalog: CatalogResponse;
  applied: Selection;
  locationLabel: string;
  compares: CompareResponse[];
  extremes: ExtremesResponse | undefined;
  retrievedAtFallback: string;
}): ExcelReportInput {
  const {
    catalog,
    applied,
    locationLabel,
    compares,
    extremes,
    retrievedAtFallback,
  } = args;
  const byVariable = new Map(
    compares.map((item) => [item.request.variable_id, item]),
  );
  const series: ExcelSeriesRow[] = [];
  for (const variable of catalog.variables) {
    const result = byVariable.get(variable.id);
    const entry = result?.series[0];
    if (result === undefined || entry === undefined) continue;
    series.push({
      id: variable.id,
      title: variable.label,
      unit: variable.unit,
      observations: entry.observations_annual.map((row) => ({
        year: row.year,
        value: row.value,
      })),
      trendLine: entry.trend?.trend_line ?? null,
      trend: entry.trend,
    });
  }
  if (extremes !== undefined) {
    for (const id of METRIC_IDS) {
      const metric = extremes.metrics[id];
      series.push({
        id,
        title: t(METRIC_LABEL[id]),
        unit: metric.unit,
        observations: metric.series.map((row) => ({
          year: row.year,
          value: row.value,
        })),
        trendLine: metric.trend?.trend_line ?? null,
        trend: metric.trend,
      });
    }
  }

  const firstCompare =
    series.length > 0
      ? byVariable.get(
          catalog.variables.find((variable) => byVariable.has(variable.id))
            ?.id ?? "",
        )
      : undefined;
  const coords = reportCoordinates(firstCompare, extremes, catalog, applied);
  const compareProvenance = firstCompare?.series[0]?.provenance;
  const extremesProvenance = extremes?.provenance;
  const provenance = compareProvenance ?? extremesProvenance;
  const retrievedAt = provenance?.retrieved_at || retrievedAtFallback;
  const spatial = spatialFromProvenance(compareProvenance, extremesProvenance);
  const analysisVersion =
    blankToNull(firstCompare?.analysis_version) ??
    blankToNull(extremes?.analysis_version) ??
    blankToNull(catalog.method.analysis_version);

  const records: ExcelRecordRow[] = [];
  const thresholds: ExcelThresholdRow[] = [];
  if (extremes !== undefined) {
    for (const id of RECORD_IDS) {
      const metric = extremes.metrics[id];
      const record = recordEntry(metric.series);
      if (record === null || record.value === null) continue;
      records.push({
        label: t(RECORD_LABEL[id]),
        value: record.value,
        unit: extremeUnitLabel(metric.unit),
        date: record.date,
      });
    }
    const seen = new Set<string>();
    for (const id of METRIC_IDS) {
      const subtitle = thresholdSubtitle(id, extremes.thresholds);
      if (subtitle === undefined || seen.has(subtitle)) continue;
      seen.add(subtitle);
      thresholds.push({ label: subtitle });
    }
  }

  return {
    locationLabel,
    latitude: coords.lat,
    longitude: coords.lon,
    startYear: applied.range.start,
    endYear: applied.range.end,
    retrievedAt,
    spatialMethod: spatial.spatialMethod,
    cellCount: spatial.cellCount,
    extremesSpatialMethod: extremesProvenance?.spatial_method,
    extremesCellCount: extremesProvenance?.cell_count,
    extremesCapitalName: extremesProvenance?.capital_name,
    analysisVersion,
    methodDescription: catalog.method.description || null,
    minYears: catalog.method.min_years,
    hacLags: catalog.method.hac_maxlags,
    confidenceLevel: catalog.method.confidence_level,
    series,
    records,
    thresholds,
    gridNote: extremes === undefined ? null : t("extremes.note"),
  };
}

export function buildExcelWorkbook(
  input: ExcelReportInput,
  exceljs: typeof import("exceljs"),
  images: ExcelChartImages,
): ExcelJS.Workbook {
  const workbook = newWorkbook(exceljs);
  workbook.creator = "Trend Detective";
  const used = new Set<string>();

  writeOverview(addSheet(workbook, t("export.sheet.overview"), used), input);

  for (const series of input.series) {
    const sheet = addSheet(workbook, series.title, used);
    writeSeriesSheet(sheet, series, images.series[series.id]);
  }

  if (input.records.length > 0 || images.extremes !== undefined) {
    const sheet = addSheet(workbook, t("export.sheet.extremes"), used);
    writeExtremesSheet(sheet, input, images.extremes);
  }

  writeMethod(addSheet(workbook, t("export.sheet.method"), used), input);
  return workbook;
}

export async function renderExcelChartImages(
  series: ExcelSeriesRow[],
  renderPng: (item: ExcelSeriesRow) => Promise<string | null>,
): Promise<ExcelChartImages> {
  const images: ExcelChartImages = { series: {} };
  for (const item of series) {
    const png = await renderPng(item);
    if (png === null) continue;
    images.series[item.id] = png;
    if (item.id === "hot_days") images.extremes = png;
  }
  if (images.extremes === undefined) {
    const fallback = series.find(
      (item) => images.series[item.id] !== undefined,
    );
    if (fallback !== undefined) images.extremes = images.series[fallback.id];
  }
  return images;
}

function writeOverview(
  sheet: ExcelJS.Worksheet,
  input: ExcelReportInput,
): void {
  sheet.columns = [
    { width: 28 },
    { width: 22 },
    { width: 22 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 20 },
  ];
  styleHeader(sheet, 1, 2, t("export.sheet.overview"));
  writeField(sheet, 3, t("export.field.location"), input.locationLabel);
  writeField(
    sheet,
    4,
    t("export.field.latitude"),
    input.latitude,
    COORD_FORMAT,
  );
  writeField(
    sheet,
    5,
    t("export.field.longitude"),
    input.longitude,
    COORD_FORMAT,
  );
  writeField(
    sheet,
    6,
    t("export.field.period"),
    formatYearRange(input.startYear, input.endYear),
  );
  writeField(sheet, 7, t("export.field.source"), EXPORT_SOURCE);
  writeField(sheet, 8, t("export.field.retrievedAt"), input.retrievedAt);
  const spatialLabel = formatSpatialMethodLabel(
    input.spatialMethod,
    input.cellCount,
  );
  if (spatialLabel !== null) {
    writeField(sheet, 9, t("export.field.spatialMethod"), spatialLabel);
  }

  const headers = [
    t("export.col.metric"),
    t("export.field.unit"),
    `${t("trend.slope")} (${t("trend.perDecade")})`,
    t("export.col.ciLow"),
    t("export.col.ciHigh"),
    t("trend.pValue"),
    t("export.field.significant"),
  ];
  styleHeaderRow(sheet, 10, headers);
  let rowIndex = 11;
  for (const series of input.series) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = series.title;
    row.getCell(2).value = catalogUnitLabel(series.unit);
    const trend = series.trend;
    if (trend !== null) {
      numCell(row.getCell(3), trend.slope_per_decade, NUMBER_FORMAT);
      numCell(row.getCell(4), trend.ci95_low, NUMBER_FORMAT);
      numCell(row.getCell(5), trend.ci95_high, NUMBER_FORMAT);
      numCell(row.getCell(6), trend.p_value, P_FORMAT);
      row.getCell(7).value = isClearTrend(trend.significance_status)
        ? t("export.significant.yes")
        : t("export.significant.no");
    }
    rowIndex += 1;
  }
}

function writeSeriesSheet(
  sheet: ExcelJS.Worksheet,
  series: ExcelSeriesRow,
  image?: string,
): void {
  sheet.columns = [{ width: 12 }, { width: 14 }, { width: 14 }];
  sheet.getCell("A1").value = series.title;
  sheet.getCell("A1").font = { bold: true, color: { argb: INK }, size: 14 };
  sheet.getCell("A2").value = catalogUnitLabel(series.unit);
  styleHeaderRow(sheet, 4, [
    t("export.col.year"),
    t("export.col.value"),
    t("export.col.trendLine"),
  ]);
  const trendByYear = new Map(
    (series.trendLine ?? []).map((point) => [point.year, point.value]),
  );
  const years = [
    ...new Set([
      ...series.observations.map((row) => row.year),
      ...trendByYear.keys(),
    ]),
  ].sort((a, b) => a - b);
  const valueByYear = new Map(
    series.observations.map((row) => [row.year, row.value]),
  );
  let rowIndex = 5;
  for (const year of years) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = year;
    const value = valueByYear.get(year);
    if (value !== undefined && value !== null) {
      numCell(row.getCell(2), value, NUMBER_FORMAT);
    }
    const trend = trendByYear.get(year);
    if (trend !== undefined) numCell(row.getCell(3), trend, NUMBER_FORMAT);
    rowIndex += 1;
  }
  if (image !== undefined) addChartImage(sheet, image);
}

function writeExtremesSheet(
  sheet: ExcelJS.Worksheet,
  input: ExcelReportInput,
  image?: string,
): void {
  sheet.columns = [{ width: 36 }, { width: 14 }, { width: 14 }, { width: 16 }];
  styleHeader(sheet, 1, 4, t("export.records"));
  styleHeaderRow(sheet, 2, [
    t("export.col.record"),
    t("export.col.value"),
    t("export.field.unit"),
    t("export.col.date"),
  ]);
  let rowIndex = 3;
  for (const record of input.records) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = record.label;
    numCell(row.getCell(2), record.value, NUMBER_FORMAT);
    row.getCell(3).value = record.unit;
    if (record.date !== null) row.getCell(4).value = record.date;
    rowIndex += 1;
  }
  const extremesSpatial = formatSpatialMethodLabel(
    input.extremesSpatialMethod,
    input.extremesCellCount,
  );
  if (extremesSpatial !== null) {
    rowIndex += 1;
    writeField(
      sheet,
      rowIndex,
      t("export.field.spatialMethod"),
      extremesSpatial,
    );
  }
  const capitalName = input.extremesCapitalName;
  if (capitalName != null && capitalName !== "") {
    rowIndex += 1;
    writeField(sheet, rowIndex, t("export.field.capitalName"), capitalName);
  }
  if (image !== undefined) addChartImage(sheet, image);
}

const MERGED_TEXT_ROW_HEIGHT = 30;

/** Merge a wrapped text block and set a height on every row in the range.
 * Excel does not auto-fit merged cells, so unheighted rows clip long copy. */
function writeMergedText(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  text: string,
): void {
  sheet.mergeCells(startRow, 1, endRow, 2);
  const cell = sheet.getCell(startRow, 1);
  cell.value = text;
  cell.alignment = { wrapText: true, vertical: "top" };
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRow(row).height = MERGED_TEXT_ROW_HEIGHT;
  }
}

function writeMethod(sheet: ExcelJS.Worksheet, input: ExcelReportInput): void {
  sheet.columns = [{ width: 28 }, { width: 88 }];
  styleHeader(sheet, 1, 2, t("export.sheet.method"));
  writeMergedText(sheet, 3, 5, t("export.method.olsHac"));
  let rowIndex = 7;
  if (input.methodDescription !== null) {
    writeMergedText(sheet, rowIndex, rowIndex + 4, input.methodDescription);
    rowIndex += 6;
  }
  writeField(
    sheet,
    rowIndex,
    t("export.method.analysisVersion"),
    input.analysisVersion ?? "",
  );
  rowIndex += 1;
  if (input.minYears !== null) {
    writeField(sheet, rowIndex, t("export.method.minYears"), input.minYears);
    rowIndex += 1;
  }
  if (input.hacLags !== null) {
    writeField(sheet, rowIndex, t("export.method.hacLags"), input.hacLags);
    rowIndex += 1;
  }
  if (input.confidenceLevel !== null) {
    writeField(
      sheet,
      rowIndex,
      t("export.method.confidenceLevel"),
      input.confidenceLevel,
    );
    rowIndex += 1;
  }
  const methodSpatial = formatSpatialMethodLabel(
    input.spatialMethod,
    input.cellCount,
  );
  if (methodSpatial !== null) {
    writeField(sheet, rowIndex, t("export.field.spatialMethod"), methodSpatial);
    rowIndex += 1;
  }
  rowIndex += 1;
  if (input.thresholds.length > 0) {
    styleHeader(sheet, rowIndex, 2, t("export.method.thresholds"));
    rowIndex += 1;
    for (const threshold of input.thresholds) {
      sheet.mergeCells(rowIndex, 1, rowIndex, 2);
      sheet.getCell(rowIndex, 1).value = threshold.label;
      rowIndex += 1;
    }
    rowIndex += 1;
  }
  if (input.gridNote !== null) {
    writeMergedText(sheet, rowIndex, rowIndex + 2, input.gridNote);
  }
}

function addChartImage(sheet: ExcelJS.Worksheet, base64: string): void {
  const id = sheet.workbook.addImage({ base64, extension: "png" });
  sheet.addImage(id, {
    tl: { col: CHART_COL, row: CHART_ROW },
    ext: { width: CHART_WIDTH, height: CHART_HEIGHT },
  });
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  used: Set<string>,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(uniqueSheetName(name, used));
  sheet.views = [{ showGridLines: false }];
  return sheet;
}

export function uniqueSheetName(name: string, used: Set<string>): string {
  const cleaned =
    name
      .replace(/[:\\/?*[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Sheet";
  const base = cleaned.slice(0, 31);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${String(n)})`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function styleHeader(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  cols: number,
  title: string,
): void {
  sheet.mergeCells(rowIndex, 1, rowIndex, cols);
  const cell = sheet.getCell(rowIndex, 1);
  cell.value = title;
  cell.font = { bold: true, color: { argb: PAPER }, size: 14 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(rowIndex).height = 22;
}

function styleHeaderRow(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  titles: string[],
): void {
  const row = sheet.getRow(rowIndex);
  titles.forEach((title, index) => {
    const cell = row.getCell(index + 1);
    cell.value = title;
    cell.font = { bold: true, color: { argb: PAPER } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    cell.alignment = { vertical: "middle" };
  });
  row.height = 18;
}

function writeField(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  label: string,
  value: string | number,
  numFmt?: string,
): void {
  const row = sheet.getRow(rowIndex);
  row.getCell(1).value = label;
  row.getCell(1).font = { bold: true, color: { argb: INK } };
  if (typeof value === "number") {
    numCell(row.getCell(2), value, numFmt ?? "0");
  } else {
    row.getCell(2).value = value;
  }
}

function numCell(cell: ExcelJS.Cell, value: number, numFmt: string): void {
  cell.value = value;
  cell.numFmt = numFmt;
}

function isClearTrend(status: TrendResult["significance_status"]): boolean {
  return status === "positive_trend" || status === "negative_trend";
}

function newWorkbook(exceljs: typeof import("exceljs")): ExcelJS.Workbook {
  const fromNamed = (exceljs as { Workbook?: new () => ExcelJS.Workbook })
    .Workbook;
  if (fromNamed !== undefined) return new fromNamed();
  return new (
    exceljs as unknown as { default: { Workbook: new () => ExcelJS.Workbook } }
  ).default.Workbook();
}

function reportCoordinates(
  compare: CompareResponse | undefined,
  extremes: ExtremesResponse | undefined,
  catalog: CatalogResponse,
  applied: Selection,
): { lat: number; lon: number } {
  const seriesLoc = compare?.series[0]?.location;
  if (seriesLoc !== undefined) {
    return { lat: seriesLoc.latitude, lon: seriesLoc.longitude };
  }
  if (extremes !== undefined) {
    return {
      lat: extremes.coordinates.latitude,
      lon: extremes.coordinates.longitude,
    };
  }
  const place = applied.place;
  if (place.kind === "point") {
    return { lat: place.lat, lon: place.lon };
  }
  const loc = catalog.locations.find((item) => item.id === place.id);
  return { lat: loc?.latitude ?? 0, lon: loc?.longitude ?? 0 };
}

function isLocationRef(loc: LocationRef | PointRef): loc is LocationRef {
  return "id" in loc;
}

function isPointRef(loc: LocationRef | PointRef): loc is PointRef {
  return "kind" in loc;
}

function blankToNull(value: string | undefined): string | null {
  return value !== undefined && value !== "" ? value : null;
}
