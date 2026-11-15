import { describe, expect, it } from "vitest";

import {
  buildExportCsv,
  buildExportJson,
  buildExtremesExport,
  exportFilename,
  formatSpatialMethodLabel,
  spatialFromProvenance,
  toExportJson,
  type ExportPayload,
} from "../src/features/compare/buildExport";
import { t } from "../src/i18n";
import { viennaExtremes } from "./extremes-stub";

const payload: ExportPayload = {
  locationLabel: 'Vienna, "Innere Stadt"',
  latitude: 48.21,
  longitude: 16.37,
  startYear: 1981,
  endYear: 2025,
  variableId: "precipitation",
  unit: "mm/year",
  annualValues: [
    { year: 1981, value: 621.91 },
    { year: 1982, value: null },
  ],
  slopePerDecade: 29.0137,
  ci95Low: 15.1937,
  ci95High: 42.8338,
  pValue: 0.00003875,
  analysisVersion: "annual-ols-hac-v2",
  source: "NASA POWER",
  retrievedAt: "2026-11-14T16:38:20.066249Z",
};

describe("client-side series export (UI-EXPORT)", () => {
  it("builds a UTF-8 BOM CSV with a metadata header, escaped fields, and year rows", () => {
    const csv = buildExportCsv(payload);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("key,value");
    expect(lines[1]).toBe('location,"Vienna, ""Innere Stadt"""');
    expect(lines[2]).toBe("latitude,48.21");
    expect(lines[3]).toBe("longitude,16.37");
    expect(lines[4]).toBe("start_year,1981");
    expect(lines[5]).toBe("end_year,2025");
    expect(lines[6]).toBe("variable,precipitation");
    expect(lines[7]).toBe("unit,mm/year");
    expect(lines[8]).toBe("slope_per_decade,29.0137");
    expect(lines).toContain("analysis_version,annual-ols-hac-v2");
    expect(lines).toContain("source,NASA POWER");
    expect(lines).toContain("retrieved_at,2026-11-14T16:38:20.066249Z");
    const blank = lines.indexOf("");
    expect(blank).toBeGreaterThan(0);
    expect(lines[blank + 1]).toBe("year,value");
    expect(lines[blank + 2]).toBe("1981,621.91");
    expect(lines[blank + 3]).toBe("1982,");
  });

  it("builds JSON with the series shape and omits missing trend and analysis fields", () => {
    const parsed: unknown = JSON.parse(buildExportJson(payload));
    expect(parsed).toEqual(toExportJson(payload));
    const full = toExportJson(payload);
    expect(full.location).toEqual({
      label: 'Vienna, "Innere Stadt"',
      latitude: 48.21,
      longitude: 16.37,
    });
    expect(full.period).toEqual({ start_year: 1981, end_year: 2025 });
    expect(full.variable).toBe("precipitation");
    expect(full.unit).toBe("mm/year");
    expect(full.annual_values).toEqual(payload.annualValues);
    expect(full.trend).toEqual({
      slope_per_decade: 29.0137,
      ci95_low: 15.1937,
      ci95_high: 42.8338,
      p_value: 0.00003875,
    });
    expect(full.analysis_version).toBe("annual-ols-hac-v2");
    expect(full.source).toBe("NASA POWER");
    expect(full.retrieved_at).toBe("2026-11-14T16:38:20.066249Z");
    expect(exportFilename(payload, "csv")).toBe(
      "trend-detective_Vienna-Innere-Stadt_precipitation_1981-2025.csv",
    );

    const sparse: ExportPayload = {
      ...payload,
      slopePerDecade: null,
      ci95Low: null,
      ci95High: null,
      pValue: null,
      analysisVersion: undefined,
    };
    const slim = toExportJson(sparse);
    expect(slim.trend).toBeUndefined();
    expect(slim.analysis_version).toBeUndefined();
    expect(buildExportCsv(sparse)).not.toContain("slope_per_decade");
    expect(buildExportCsv(sparse)).not.toContain("analysis_version");
  });
});

describe("spatial method in series export (UI-EXPORT-SPATIAL)", () => {
  it("passes area_weighted_grid and cell_count through JSON and CSV", () => {
    const grid: ExportPayload = {
      ...payload,
      spatialMethod: "area_weighted_grid",
      cellCount: 16,
    };
    const json = toExportJson(grid);
    expect(json.spatial_method).toBe("area_weighted_grid");
    expect(json.cell_count).toBe(16);
    const csv = buildExportCsv(grid);
    expect(csv).toContain("spatial_method,area_weighted_grid");
    expect(csv).toContain("cell_count,16");
    expect(formatSpatialMethodLabel("area_weighted_grid", 16)).toBe(
      t("export.spatial.areaWeightedGrid").replaceAll("{count}", "16"),
    );
  });

  it("passes area_weighted_states through and omits a missing cell_count", () => {
    const states: ExportPayload = {
      ...payload,
      spatialMethod: "area_weighted_states",
      cellCount: null,
    };
    const json = toExportJson(states);
    expect(json.spatial_method).toBe("area_weighted_states");
    expect(json.cell_count).toBeNull();
    const csv = buildExportCsv(states);
    expect(csv).toContain("spatial_method,area_weighted_states");
    expect(csv).not.toContain("cell_count");
    expect(formatSpatialMethodLabel("area_weighted_states", null)).toBe(
      t("export.spatial.areaWeightedStates"),
    );
  });

  it("passes a null spatial_method through JSON and omits it as an empty CSV value, with no cell_count", () => {
    const point: ExportPayload = {
      ...payload,
      spatialMethod: null,
      cellCount: null,
    };
    const json = toExportJson(point);
    expect(json.spatial_method).toBeNull();
    expect(json.cell_count).toBeNull();
    const csv = buildExportCsv(point);
    expect(csv).toContain("spatial_method,");
    expect(csv).not.toContain("cell_count");
    expect(formatSpatialMethodLabel(null, null)).toBe(
      t("export.spatial.gridPoint"),
    );
  });

  it("omits spatial fields when they were not on the payload", () => {
    const json = toExportJson(payload);
    expect(json.spatial_method).toBeUndefined();
    expect(json.cell_count).toBeUndefined();
    expect(buildExportCsv(payload)).not.toContain("spatial_method");
    expect(buildExportCsv(payload)).not.toContain("cell_count");
    expect(formatSpatialMethodLabel(undefined, undefined)).toBeNull();
  });
});

describe("spatialFromProvenance (UI-EXT-LOCID)", () => {
  it("falls back to extremes when compare provenance lacks spatial fields", () => {
    expect(
      spatialFromProvenance(
        {},
        { spatial_method: "area_weighted_grid", cell_count: 16 },
      ),
    ).toEqual({
      spatialMethod: "area_weighted_grid",
      cellCount: 16,
    });
  });

  it("keeps compare provenance when it already has spatial fields", () => {
    expect(
      spatialFromProvenance(
        { spatial_method: "area_weighted_states", cell_count: null },
        { spatial_method: "area_weighted_grid", cell_count: 16 },
      ),
    ).toEqual({
      spatialMethod: "area_weighted_states",
      cellCount: null,
    });
  });
});

describe("capital_point in extremes export (UI-EXTCAP)", () => {
  it("labels capital_point and passes capital_name through JSON and CSV", () => {
    const capital: ExportPayload = {
      ...payload,
      spatialMethod: "capital_point",
      cellCount: null,
      capitalName: "Sankt Pölten",
    };
    const json = toExportJson(capital);
    expect(json.spatial_method).toBe("capital_point");
    expect(json.capital_name).toBe("Sankt Pölten");
    expect(json.cell_count).toBeNull();
    const csv = buildExportCsv(capital);
    expect(csv).toContain("spatial_method,capital_point");
    expect(csv).toContain("capital_name,Sankt Pölten");
    expect(csv).not.toContain("cell_count");
    expect(formatSpatialMethodLabel("capital_point", null)).toBe(
      t("export.spatial.capitalPoint"),
    );
  });

  it("passes a null capital_name through JSON and as an empty CSV value", () => {
    const capital: ExportPayload = {
      ...payload,
      spatialMethod: "capital_point",
      capitalName: null,
    };
    const json = toExportJson(capital);
    expect(json.capital_name).toBeNull();
    expect(buildExportCsv(capital)).toContain("capital_name,");
    expect(toExportJson(payload).capital_name).toBeUndefined();
    expect(buildExportCsv(payload)).not.toContain("capital_name");
  });

  it("copies capital_name from extremes provenance", () => {
    const result = viennaExtremes();
    const named = buildExtremesExport(
      {
        ...result,
        provenance: {
          ...result.provenance,
          spatial_method: "capital_point",
          capital_name: "Sankt Pölten",
        },
      },
      "hottest_day",
      "Lower Austria",
      "2026-11-15T00:00:00Z",
    );
    expect(named?.spatialMethod).toBe("capital_point");
    expect(named?.capitalName).toBe("Sankt Pölten");

    const unnamed = buildExtremesExport(
      {
        ...result,
        provenance: {
          ...result.provenance,
          spatial_method: "capital_point",
          capital_name: null,
        },
      },
      "hottest_day",
      "Lower Austria",
      "2026-11-15T00:00:00Z",
    );
    expect(unnamed?.capitalName).toBeNull();
  });
});
