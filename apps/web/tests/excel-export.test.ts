import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildExcelWorkbook,
  uniqueSheetName,
  type ExcelReportInput,
} from "../src/features/compare/buildExcelReport";
import type { TrendResult } from "../src/features/compare/contract";
import { t } from "../src/i18n";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function trend(
  status: TrendResult["significance_status"],
  slope: number,
): TrendResult {
  return {
    method: "ols_hac",
    method_version: "annual-ols-hac-v2",
    n_years: 45,
    start_year: 1981,
    end_year: 2025,
    slope_per_decade: slope,
    ci95_low: slope - 1,
    ci95_high: slope + 1,
    p_value: 0.0001,
    significance_status: status,
    diagnostic_flags: [],
    trend_line: [
      { year: 1981, value: 10 },
      { year: 1982, value: 10.2 },
    ],
  };
}

const input: ExcelReportInput = {
  locationLabel: "Vienna",
  latitude: 48.21,
  longitude: 16.37,
  startYear: 1981,
  endYear: 2025,
  retrievedAt: "2026-11-14T16:38:20.066249Z",
  analysisVersion: "annual-ols-hac-v2",
  methodDescription: "Ordinary least squares on complete annual values.",
  minYears: 3,
  hacLags: 3,
  confidenceLevel: 0.95,
  series: [
    {
      id: "temperature",
      title: "Temperature",
      unit: "degC",
      observations: [
        { year: 1981, value: 9.5 },
        { year: 1982, value: 10.1 },
      ],
      trendLine: [
        { year: 1981, value: 9.6 },
        { year: 1982, value: 9.7 },
      ],
      trend: trend("positive_trend", 0.45),
    },
    {
      id: "hot_days",
      title: "Hot days",
      unit: "days",
      observations: [{ year: 1981, value: 12 }],
      trendLine: [{ year: 1981, value: 11 }],
      trend: trend("no_clear_trend", 0.02),
    },
  ],
  records: [
    { label: "Hottest day", value: 38.53, unit: "°C", date: "2013-08-08" },
  ],
  thresholds: [{ label: "Hot day from 30 °C" }],
  gridNote: "Values are for the NASA POWER grid cell that contains this point.",
};

describe("Excel report workbook (UI-XLSX)", () => {
  it("writes sheet names and key header cells, with mocked chart images", () => {
    const workbook = buildExcelWorkbook(input, ExcelJS, {
      series: { temperature: PNG, hot_days: PNG },
      extremes: PNG,
    });
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toEqual([
      t("export.sheet.overview"),
      "Temperature",
      "Hot days",
      t("export.sheet.extremes"),
      t("export.sheet.method"),
    ]);

    const overview = workbook.getWorksheet(t("export.sheet.overview"));
    expect(overview).toBeDefined();
    expect(overview?.getCell("A1").value).toBe(t("export.sheet.overview"));
    expect(overview?.getCell("A3").value).toBe(t("export.field.location"));
    expect(overview?.getCell("B3").value).toBe("Vienna");
    expect(overview?.getCell("A7").value).toBe(t("export.field.source"));
    expect(overview?.getCell("B7").value).toBe("NASA POWER");
    expect(overview?.getCell("A8").value).toBe(t("export.field.retrievedAt"));
    expect(overview?.getCell("B8").value).toBe("2026-11-14T16:38:20.066249Z");
    expect(overview?.getCell("A9").value).toBeNull();
    expect(overview?.getCell("A10").value).toBe(t("export.col.metric"));
    expect(overview?.getCell("A11").value).toBe("Temperature");
    expect(overview?.getCell("G11").value).toBe(t("export.significant.yes"));
    expect(overview?.getCell("A12").value).toBe("Hot days");
    expect(overview?.getCell("G12").value).toBe(t("export.significant.no"));

    const temperature = workbook.getWorksheet("Temperature");
    expect(temperature?.getCell("A1").value).toBe("Temperature");
    expect(temperature?.getCell("A4").value).toBe(t("export.col.year"));
    expect(temperature?.getCell("B4").value).toBe(t("export.col.value"));
    expect(temperature?.getCell("C4").value).toBe(t("export.col.trendLine"));
    expect(temperature?.getCell("A5").value).toBe(1981);
    expect(temperature?.getCell("B5").value).toBe(9.5);
    expect(temperature?.getCell("C5").value).toBe(9.6);

    const extremes = workbook.getWorksheet(t("export.sheet.extremes"));
    expect(extremes?.getCell("A1").value).toBe(t("export.records"));
    expect(extremes?.getCell("A3").value).toBe("Hottest day");
    expect(extremes?.getCell("D3").value).toBe("2013-08-08");

    const method = workbook.getWorksheet(t("export.sheet.method"));
    expect(method?.getCell("A1").value).toBe(t("export.sheet.method"));
    expect(method?.getCell("A3").value).toBe(t("export.method.olsHac"));
    expect(method?.getCell("A3").alignment.wrapText).toBe(true);
    expect(method?.getRow(3).height).toBe(30);
    expect(method?.getRow(4).height).toBe(30);
    expect(method?.getRow(5).height).toBe(30);
    expect(method?.getCell("A7").alignment.wrapText).toBe(true);
    expect(method?.getRow(7).height).toBe(30);
    expect(method?.getRow(11).height).toBe(30);
    expect(method?.getCell("A13").value).toBe(
      t("export.method.analysisVersion"),
    );
    expect(method?.getCell("B13").value).toBe("annual-ols-hac-v2");
    expect(method?.getCell("A21").alignment.wrapText).toBe(true);
    expect(method?.getRow(21).height).toBe(30);
    expect(method?.getRow(23).height).toBe(30);
  });

  it("sanitizes sheet names to 31 characters without invalid characters", () => {
    const used = new Set<string>();
    expect(uniqueSheetName("A:B/C?*[D]", used)).toBe("A B C D");
    expect(uniqueSheetName("x".repeat(40), used).length).toBe(31);
    const first = uniqueSheetName("Overview", used);
    const second = uniqueSheetName("Overview", used);
    expect(first).toBe("Overview");
    expect(second).toBe("Overview (2)");
  });
});

describe("spatial method in the Excel report (UI-EXPORT-SPATIAL)", () => {
  it("shows an area-weighted grid mean with the API cell_count", () => {
    const workbook = buildExcelWorkbook(
      { ...input, spatialMethod: "area_weighted_grid", cellCount: 16 },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const label = t("export.spatial.areaWeightedGrid").replaceAll(
      "{count}",
      "16",
    );
    const overview = workbook.getWorksheet(t("export.sheet.overview"));
    expect(overview?.getCell("A9").value).toBe(t("export.field.spatialMethod"));
    expect(overview?.getCell("B9").value).toBe(label);
    const method = workbook.getWorksheet(t("export.sheet.method"));
    expect(method?.getCell("A17").value).toBe(t("export.field.spatialMethod"));
    expect(method?.getCell("B17").value).toBe(label);
  });

  it("shows the area-weighted state means label without inventing a cell count", () => {
    const workbook = buildExcelWorkbook(
      { ...input, spatialMethod: "area_weighted_states", cellCount: null },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const label = t("export.spatial.areaWeightedStates");
    const overview = workbook.getWorksheet(t("export.sheet.overview"));
    expect(overview?.getCell("B9").value).toBe(label);
    const method = workbook.getWorksheet(t("export.sheet.method"));
    expect(method?.getCell("B17").value).toBe(label);
  });

  it("shows the grid-point label when spatial_method is null", () => {
    const workbook = buildExcelWorkbook(
      { ...input, spatialMethod: null, cellCount: null },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const overview = workbook.getWorksheet(t("export.sheet.overview"));
    expect(overview?.getCell("A9").value).toBe(t("export.field.spatialMethod"));
    expect(overview?.getCell("B9").value).toBe(t("export.spatial.gridPoint"));
    const method = workbook.getWorksheet(t("export.sheet.method"));
    expect(method?.getCell("B17").value).toBe(t("export.spatial.gridPoint"));
  });

  it("uses extremes provenance on the Extremes sheet and as a report fallback", () => {
    const label = t("export.spatial.areaWeightedGrid").replaceAll(
      "{count}",
      "16",
    );
    const workbook = buildExcelWorkbook(
      {
        ...input,
        spatialMethod: "area_weighted_grid",
        cellCount: 16,
        extremesSpatialMethod: "area_weighted_grid",
        extremesCellCount: 16,
      },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const overview = workbook.getWorksheet(t("export.sheet.overview"));
    expect(overview?.getCell("B9").value).toBe(label);
    const extremes = workbook.getWorksheet(t("export.sheet.extremes"));
    expect(extremes?.getCell("A5").value).toBe(t("export.field.spatialMethod"));
    expect(extremes?.getCell("B5").value).toBe(label);
  });

  it("shows capital_point and the capital name on the Extremes sheet (UI-EXTCAP)", () => {
    const workbook = buildExcelWorkbook(
      {
        ...input,
        extremesSpatialMethod: "capital_point",
        extremesCellCount: null,
        extremesCapitalName: "Sankt Pölten",
      },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const extremes = workbook.getWorksheet(t("export.sheet.extremes"));
    expect(extremes?.getCell("A5").value).toBe(t("export.field.spatialMethod"));
    expect(extremes?.getCell("B5").value).toBe(
      t("export.spatial.capitalPoint"),
    );
    expect(extremes?.getCell("A6").value).toBe(t("export.field.capitalName"));
    expect(extremes?.getCell("B6").value).toBe("Sankt Pölten");
  });

  it("omits the capital name row when capital_name is null (UI-EXTCAP)", () => {
    const workbook = buildExcelWorkbook(
      {
        ...input,
        extremesSpatialMethod: "capital_point",
        extremesCapitalName: null,
      },
      ExcelJS,
      { series: { temperature: PNG, hot_days: PNG }, extremes: PNG },
    );
    const extremes = workbook.getWorksheet(t("export.sheet.extremes"));
    expect(extremes?.getCell("B5").value).toBe(
      t("export.spatial.capitalPoint"),
    );
    expect(extremes?.getCell("A6").value).not.toBe(
      t("export.field.capitalName"),
    );
  });
});
