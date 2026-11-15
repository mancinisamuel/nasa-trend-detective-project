import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../src/app/providers";
import { CompareMetrics } from "../src/features/compare/CompareMetrics";
import {
  CompareSelectionProvider,
  useCompareSelection,
} from "../src/features/compare/CompareSelection";
import { CompareSheet } from "../src/features/compare/CompareSheet";
import type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
  SeriesResult,
  TrendResult,
} from "../src/features/compare/contract";
import { capitalPointNote } from "../src/features/extremes/ExtremesRecords";
import { buildExtremesQuery } from "../src/features/extremes/extremesRequest";
import { t } from "../src/i18n";
import { isExtremesUrl, viennaExtremes } from "./extremes-stub";

const vienna = {
  id: "vienna",
  label: "Vienna",
  latitude: 48.21,
  longitude: 16.37,
  spatial_kind: "grid_point" as const,
};

const catalog: CatalogResponse = {
  data_mode: "live",
  variables: [
    {
      id: "temperature_2m",
      label: "Air temperature at 2 m",
      description: "test",
      provider_parameter: "T2M",
      unit: "degC",
      aggregation: "day_weighted_mean",
      enabled: true,
      available_from_year: 1981,
      available_to_year: 2025,
    },
  ],
  locations: [
    vienna,
    {
      id: "at",
      label: "Austria",
      latitude: 47.59,
      longitude: 14.12,
      spatial_kind: "region",
    },
    {
      id: "at-niederoesterreich",
      label: "Lower Austria",
      latitude: 48.2,
      longitude: 15.63,
      spatial_kind: "region",
    },
    {
      id: "usa",
      label: "United States",
      latitude: 39.83,
      longitude: -98.58,
      spatial_kind: "region",
    },
  ],
  year_bounds: { min_year: 1981, max_year: 2025, max_years_per_request: 50 },
  default_baseline: { start_year: 1991, end_year: 2020 },
  method: {
    analysis_version: "v",
    method: "ols_hac",
    description: "test",
    min_years: 30,
    hac_maxlags: 3,
    confidence_level: 0.95,
    slope_unit: "per_decade",
  },
};

const compareTrend: TrendResult = {
  method: "ols_hac",
  method_version: "ols-hac-nw3-v1",
  n_years: 45,
  start_year: 1981,
  end_year: 2025,
  slope_per_decade: 0.45,
  ci95_low: 0.3,
  ci95_high: 0.6,
  p_value: 0.001,
  significance_status: "positive_trend",
  diagnostic_flags: [],
};

function compareSeries(): SeriesResult {
  return {
    location: vienna,
    observations_monthly: [],
    observations_annual: [
      { year: 1981, value: 10, valid_months: 12, expected_months: 12 },
    ],
    anomalies_annual: [],
    trend: compareTrend,
    quality: {
      status: "complete",
      missing_months: [],
      complete_years: [],
      coverage_fraction: 1,
      warnings: [],
      baseline_status: "complete",
    },
    provenance: {
      provider: "demo",
      dataset: "demo",
      parameter: "T2M",
      community: "RE",
      requested_coordinates: { latitude: 48.21, longitude: 16.37 },
      returned_coordinates: null,
      retrieved_at: "2026-11-15T08:00:00Z",
      source_url: null,
      raw_sha256: "0",
      provider_version: null,
    },
    cache_status: "miss",
  };
}

function compareResponse(request: CompareRequest): CompareResponse {
  return {
    schema_version: "1.0",
    analysis_version: "v",
    result_id: "r",
    request_id: "q",
    data_mode: "live",
    cache_status: "miss",
    generated_at: "2026-11-15T08:00:00Z",
    request,
    series: [compareSeries()],
    comparison: { common_years: [], warnings: [] },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function SelectionButtons() {
  const { setLocation, pickOnMap, apply } = useCompareSelection();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLocation("at");
        }}
      >
        choose-austria
      </button>
      <button
        type="button"
        onClick={() => {
          setLocation("at-niederoesterreich");
        }}
      >
        choose-lower-austria
      </button>
      <button
        type="button"
        onClick={() => {
          setLocation("usa");
        }}
      >
        choose-usa
      </button>
      <button
        type="button"
        onClick={() => {
          pickOnMap({
            kind: "area",
            id: "US-TX",
            name: "Texas",
            centroid: [-99.3506, 31.4845],
          });
        }}
      >
        choose-texas
      </button>
      <button
        type="button"
        onClick={() => {
          apply();
        }}
      >
        apply-selection
      </button>
    </>
  );
}

function renderResults(response = viennaExtremes()) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/catalog") return Promise.resolve(json(catalog));
    if (url === "/api/v1/compare" && typeof init?.body === "string") {
      return Promise.resolve(
        json(compareResponse(JSON.parse(init.body) as CompareRequest)),
      );
    }
    if (isExtremesUrl(url)) return Promise.resolve(json(response));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CompareSelectionProvider>
      <SelectionButtons />
      <CompareSheet />
      <CompareMetrics />
    </CompareSelectionProvider>,
    { wrapper: AppProviders },
  );
  return fetchMock;
}

function extremesUrls(fetchMock: ReturnType<typeof renderResults>): URL[] {
  return fetchMock.mock.calls
    .filter(([url]) => typeof url === "string" && isExtremesUrl(url))
    .map(([url]) => new URL(url, "http://localhost"));
}

function extremesUrl(fetchMock: ReturnType<typeof renderResults>): URL {
  const url = extremesUrls(fetchMock)[0];
  if (url === undefined) {
    throw new Error("expected a GET /api/v1/extremes request");
  }
  return url;
}

describe("extremes in the results chart (UI-ONECHART)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows record tiles in the sidebar and renders an extremes series when selected", async () => {
    const fetchMock = renderResults();
    const sidebar = await screen.findByTestId("compare-metrics");
    const tiles = await within(sidebar).findAllByTestId("extremes-record");
    const url = extremesUrl(fetchMock);
    expect(url.searchParams.get("lat")).toBe("48.21");
    expect(url.searchParams.get("lon")).toBe("16.37");
    expect(url.searchParams.get("location_id")).toBeNull();
    expect(url.searchParams.get("start_year")).toBe("1981");
    expect(url.searchParams.get("end_year")).toBe("2025");

    expect(tiles).toHaveLength(3);
    expect(tiles[0]?.textContent).toContain(t("extremes.record.hottest_day"));
    expect(tiles[0]?.textContent).toContain(`38.53 ${t("unit.degC")}`);
    expect(tiles[0]?.textContent).toContain("2013-08-08");
    expect(tiles[1]?.textContent).toContain(t("extremes.record.wettest_day"));
    expect(tiles[1]?.textContent).toContain(`54.78 ${t("unit.mm_day")}`);
    expect(tiles[1]?.textContent).toContain("2024-09-14");
    expect(tiles[2]?.textContent).toContain(
      t("extremes.record.max_hourly_wind"),
    );
    expect(tiles[2]?.textContent).toContain(`17.85 ${t("unit.m_s")}`);
    expect(tiles[2]?.textContent).toContain("2020-02-04");
    expect(tiles[2]?.textContent.toLowerCase()).not.toContain("gust");

    // Records stay in the sidebar before an extremes metric is chosen; the note is hidden.
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.change(screen.getByLabelText(t("compare.variable")), {
      target: { value: "hot_days" },
    });
    const chart = await screen.findByTestId("series-chart");
    expect(screen.getAllByTestId("series-chart")).toHaveLength(1);
    expect(chart.textContent).toContain(t("extremes.metric.hot_days"));
    expect(chart.textContent).toContain(
      `${t("extremes.threshold.hot_day")} 30 ${t("unit.degC")}`,
    );
    // UI-DESIGN-3: title, threshold and caveat sit in the info tooltip, not above the chart.
    expect(screen.queryByRole("note")).toBeNull();
    const tooltip = screen.getByTestId("chart-info-tooltip");
    expect(tooltip.textContent).toContain(t("extremes.metric.hot_days"));
    expect(tooltip.textContent).toContain(
      `${t("extremes.threshold.hot_day")} 30 ${t("unit.degC")}`,
    );
    expect(tooltip.textContent).toContain(t("extremes.note"));

    const trend = within(sidebar).getByTestId("trend-summary");
    expect(trend.textContent).toContain(t("trend.slope"));
    expect(trend.textContent).toContain(`+3.44 ${t("unit.days")}`);
    expect(trend.textContent).toContain(t("trend.pValue"));
    expect(trend.textContent).toContain("< 0.001");
    expect(within(sidebar).getAllByTestId("extremes-record")).toHaveLength(3);
  });

  it("requests extremes for a catalog region and for a map-picked state centroid", async () => {
    const fetchMock = renderResults();
    await screen.findByTestId("compare-metrics");
    await within(screen.getByTestId("compare-metrics")).findAllByTestId(
      "extremes-record",
    );

    fireEvent.click(screen.getByRole("button", { name: "choose-austria" }));
    fireEvent.click(screen.getByRole("button", { name: "apply-selection" }));
    await vi.waitFor(() => {
      const url = extremesUrls(fetchMock).at(-1);
      expect(url?.searchParams.get("location_id")).toBe("at");
      expect(url?.searchParams.get("lat")).toBeNull();
      expect(url?.searchParams.get("lon")).toBeNull();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "choose-lower-austria" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "apply-selection" }));
    await vi.waitFor(() => {
      const url = extremesUrls(fetchMock).at(-1);
      expect(url?.searchParams.get("location_id")).toBe("at-niederoesterreich");
      expect(url?.searchParams.get("lat")).toBeNull();
      expect(url?.searchParams.get("lon")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "choose-texas" }));
    fireEvent.click(screen.getByRole("button", { name: "apply-selection" }));
    await vi.waitFor(() => {
      const url = extremesUrls(fetchMock).at(-1);
      expect(url?.searchParams.get("lat")).toBe("31.4845");
      expect(url?.searchParams.get("lon")).toBe("-99.3506");
      expect(url?.searchParams.get("location_id")).toBeNull();
    });
  });

  it("shows a loading state in the records area while extremes are in flight", async () => {
    const pending = new Promise<Response>(() => {
      /* hang until the test ends */
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/catalog") return Promise.resolve(json(catalog));
      if (url === "/api/v1/compare" && typeof init?.body === "string") {
        return Promise.resolve(
          json(compareResponse(JSON.parse(init.body) as CompareRequest)),
        );
      }
      if (isExtremesUrl(url)) return pending;
      return Promise.resolve(json({}, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CompareSelectionProvider>
        <CompareSheet />
        <CompareMetrics />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    const loading = await screen.findByTestId("extremes-records-loading");
    expect(loading.textContent).toBe(t("extremes.loading"));
    expect(screen.queryByTestId("extremes-records")).toBeNull();
  });

  it("shows a note for usa extremes and does not request or error", async () => {
    const pending = new Promise<Response>(() => {
      /* hang compare until the test ends */
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/catalog") return Promise.resolve(json(catalog));
      if (url === "/api/v1/compare" && typeof init?.body === "string") {
        const request = JSON.parse(init.body) as CompareRequest;
        const ref = request.locations[0];
        if (ref !== undefined && "id" in ref && ref.id === "usa") {
          return pending;
        }
        return Promise.resolve(json(compareResponse(request)));
      }
      if (isExtremesUrl(url)) return Promise.resolve(json(viennaExtremes()));
      return Promise.resolve(json({}, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CompareSelectionProvider>
        <SelectionButtons />
        <CompareSheet />
        <CompareMetrics />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    await screen.findByTestId("extremes-records");

    fireEvent.click(screen.getByRole("button", { name: "choose-usa" }));
    fireEvent.click(screen.getByRole("button", { name: "apply-selection" }));

    const note = await screen.findByTestId("extremes-region-unsupported");
    expect(note.textContent).toBe(t("extremes.regionUnsupported"));
    expect(screen.queryByText(t("extremes.error"))).toBeNull();
    expect(screen.queryByTestId("extremes-records")).toBeNull();
    expect(
      (await screen.findAllByText(t("compare.loading"))).length,
    ).toBeGreaterThan(0);
    const extremesCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && isExtremesUrl(url),
    );
    expect(
      extremesCalls.every((call) => {
        const href = call[0];
        if (typeof href !== "string") return false;
        return (
          new URL(href, "http://localhost").searchParams.get("location_id") !==
          "usa"
        );
      }),
    ).toBe(true);
  });
});

describe("capital-point note (UI-EXTCAP)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a one-line capital caption and an info tooltip when spatial_method is capital_point", async () => {
    const response = viennaExtremes();
    renderResults({
      ...response,
      provenance: {
        ...response.provenance,
        spatial_method: "capital_point",
        capital_name: "Sankt Pölten",
      },
    });
    const caption = await screen.findByTestId("extremes-capital-note");
    expect(caption.querySelector(".extremes__capital-label")?.textContent).toBe(
      t("extremes.capitalNote").replaceAll("{name}", "Sankt Pölten"),
    );
    const info = screen.getByTestId("extremes-capital-info");
    const tooltip = screen.getByTestId("extremes-capital-tooltip");
    expect(info.getAttribute("aria-label")).toBe(t("extremes.capitalInfo"));
    expect(info.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    expect(tooltip.hidden).toBe(true);
    fireEvent.mouseEnter(info);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe(t("extremes.capitalInfo"));
    fireEvent.mouseLeave(info);
    expect(tooltip.hidden).toBe(true);
    fireEvent.focus(info);
    expect(tooltip.hidden).toBe(false);
    fireEvent.blur(info);
    expect(tooltip.hidden).toBe(true);
    expect(screen.getByTestId("extremes-records")).toBeDefined();
  });

  it("shows the unnamed capital caption when capital_name is null", async () => {
    const response = viennaExtremes();
    renderResults({
      ...response,
      provenance: {
        ...response.provenance,
        spatial_method: "capital_point",
        capital_name: null,
      },
    });
    const caption = await screen.findByTestId("extremes-capital-note");
    expect(caption.querySelector(".extremes__capital-label")?.textContent).toBe(
      t("extremes.capitalNote.unnamed"),
    );
    expect(screen.getByTestId("extremes-capital-info")).toBeDefined();
  });

  it("does not show a capital note for other spatial methods", () => {
    expect(
      capitalPointNote({
        spatial_method: "area_weighted_grid",
        capital_name: "Sankt Pölten",
      }),
    ).toBeNull();
    expect(
      capitalPointNote({ spatial_method: null, capital_name: null }),
    ).toBeNull();
    expect(
      capitalPointNote({
        spatial_method: "capital_point",
        capital_name: "",
      }),
    ).toBe(t("extremes.capitalNote.unnamed"));
  });
});

describe("buildExtremesQuery (UI-EXT-LOCID)", () => {
  const range = { start: 1981, end: 2025 };

  it("sends location_id only for spatial_kind region, and lat/lon for a point", () => {
    expect(
      buildExtremesQuery(catalog, { kind: "catalog", id: "at" }, range),
    ).toEqual({
      location_id: "at",
      start_year: 1981,
      end_year: 2025,
    });
    expect(
      buildExtremesQuery(
        catalog,
        { kind: "catalog", id: "at-niederoesterreich" },
        range,
      ),
    ).toEqual({
      location_id: "at-niederoesterreich",
      start_year: 1981,
      end_year: 2025,
    });
    const withUsState: CatalogResponse = {
      ...catalog,
      locations: [
        ...catalog.locations,
        {
          id: "us-tx",
          label: "Texas",
          latitude: 31.43,
          longitude: -99.28,
          spatial_kind: "region",
        },
      ],
    };
    expect(
      buildExtremesQuery(withUsState, { kind: "catalog", id: "us-tx" }, range),
    ).toEqual({
      location_id: "us-tx",
      start_year: 1981,
      end_year: 2025,
    });
    // An id prefix alone is not enough: only spatial_kind "region" uses location_id.
    const prefixOnly: CatalogResponse = {
      ...catalog,
      locations: [
        ...catalog.locations,
        {
          id: "at-prefix-only",
          label: "Prefix only",
          latitude: 47.0,
          longitude: 13.0,
          spatial_kind: "grid_point",
        },
      ],
    };
    expect(
      buildExtremesQuery(
        prefixOnly,
        { kind: "catalog", id: "at-prefix-only" },
        range,
      ),
    ).toEqual({
      lat: 47.0,
      lon: 13.0,
      start_year: 1981,
      end_year: 2025,
    });
    expect(
      buildExtremesQuery(catalog, { kind: "catalog", id: "usa" }, range),
    ).toBeNull();
    expect(
      buildExtremesQuery(catalog, { kind: "catalog", id: "vienna" }, range),
    ).toEqual({
      lat: 48.21,
      lon: 16.37,
      start_year: 1981,
      end_year: 2025,
    });
    expect(
      buildExtremesQuery(
        catalog,
        { kind: "point", lat: 31.4845, lon: -99.3506, label: "Texas" },
        range,
      ),
    ).toEqual({
      lat: 31.4845,
      lon: -99.3506,
      start_year: 1981,
      end_year: 2025,
    });
  });
});
