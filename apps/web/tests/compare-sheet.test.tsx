import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../src/app/providers";
import {
  YearRangeSlider,
  type YearRange,
} from "../src/components/ui/YearRangeSlider";
import {
  CompareSelectionProvider,
  useCompareSelection,
} from "../src/features/compare/CompareSelection";
import { CompareMetrics } from "../src/features/compare/CompareMetrics";
import { CompareSheet } from "../src/features/compare/CompareSheet";
import { CompareTimeline } from "../src/features/compare/CompareTimeline";
import { placeFromPick } from "../src/features/compare/mapSelection";
import { COMPARE_TIMEOUT_MS } from "../src/features/compare/compareApi";
import { TrendSummary } from "../src/features/evidence/TrendSummary";
import { TrendVerdict } from "../src/features/evidence/TrendVerdict";
import type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
  ErrorResponse,
  LocationRef,
  PointRef,
  SeriesResult,
  TrendResult,
} from "../src/features/compare/contract";
import { t } from "../src/i18n";
import { isExtremesUrl, minimalExtremes } from "./extremes-stub";
import { CalculateStub } from "./calculate-stub";

const vienna = {
  id: "vienna",
  label: "Vienna",
  latitude: 48.21,
  longitude: 16.37,
  spatial_kind: "grid_point",
} as const;
const madrid = {
  id: "madrid",
  label: "Madrid",
  latitude: 40.42,
  longitude: -3.7,
  spatial_kind: "grid_point",
} as const;
const austria = {
  id: "at",
  label: "Austria",
  latitude: 47.59,
  longitude: 14.12,
  spatial_kind: "region",
} as const;

function catalog(dataMode: CatalogResponse["data_mode"]): CatalogResponse {
  return {
    data_mode: dataMode,
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
      {
        id: "precipitation",
        label: "Precipitation (bias corrected)",
        description: "test",
        provider_parameter: "PRECTOTCORR",
        unit: "mm/year",
        aggregation: "calendar_day_sum",
        enabled: true,
        available_from_year: 1981,
        available_to_year: 2025,
      },
      {
        id: "disabled_var",
        label: "Disabled variable",
        description: "test",
        provider_parameter: "X",
        unit: "x",
        aggregation: "day_weighted_mean",
        enabled: false,
        available_from_year: 1981,
        available_to_year: 2025,
      },
    ],
    locations: [vienna, madrid, austria],
    year_bounds: { min_year: 1981, max_year: 2025, max_years_per_request: 50 },
    default_baseline: { start_year: 1991, end_year: 2020 },
    method: {
      analysis_version: "annual-ols-hac-v1",
      method: "ols_hac",
      description: "test",
      min_years: 30,
      hac_maxlags: 3,
      confidence_level: 0.95,
      slope_unit: "per_decade",
    },
  };
}

const trend: TrendResult = {
  method: "ols_hac",
  method_version: "ols-hac-nw3-v1",
  n_years: 45,
  start_year: 1981,
  end_year: 2025,
  slope_per_decade: 0.4512,
  ci95_low: 0.3021,
  ci95_high: 0.6003,
  p_value: 0.0000123,
  significance_status: "positive_trend",
  diagnostic_flags: [],
};

function series(overrides: Partial<SeriesResult> = {}): SeriesResult {
  return {
    location: vienna,
    observations_monthly: [],
    observations_annual: [],
    anomalies_annual: [],
    trend,
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
      retrieved_at: "2026-11-14T13:00:00Z",
      source_url: null,
      raw_sha256: "0",
      provider_version: null,
    },
    cache_status: "miss",
    ...overrides,
  };
}

function compareResponse(
  request: CompareRequest,
  result: SeriesResult,
  overrides: Partial<CompareResponse> = {},
): CompareResponse {
  return {
    schema_version: "1.0",
    analysis_version: "annual-ols-hac-v1",
    result_id: "r",
    request_id: "q",
    data_mode: "demo",
    cache_status: "miss",
    generated_at: "2026-11-14T13:00:00Z",
    request,
    series: [result],
    comparison: { common_years: [], warnings: [] },
    ...overrides,
  };
}

const errorBody: ErrorResponse = {
  error: {
    code: "PROVIDER_UNAVAILABLE",
    message: "unavailable",
    request_id: "q",
    retryable: true,
    details: null,
  },
};

/** Catalog id of a request location; a free point (PointRef) has none. */
function refId(ref: LocationRef | PointRef | undefined): string | undefined {
  return ref !== undefined && "id" in ref ? ref.id : undefined;
}

function bodyOf(init: RequestInit | undefined): CompareRequest {
  if (typeof init?.body !== "string") throw new Error("expected a JSON body");
  return JSON.parse(init.body) as CompareRequest;
}

type Respond = (request: CompareRequest) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(
  respond: Respond,
  mode: CatalogResponse["data_mode"] = "demo",
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/catalog") return Promise.resolve(json(catalog(mode)));
    if (url === "/api/v1/compare" && typeof init?.body === "string") {
      return Promise.resolve(respond(JSON.parse(init.body) as CompareRequest));
    }
    if (isExtremesUrl(url)) return Promise.resolve(json(minimalExtremes()));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentRequests(fetchMock: ReturnType<typeof stubApi>): CompareRequest[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/v1/compare")
    .map(([, init]) => bodyOf(init));
}

const onApply = vi.fn();

/** Chooses a catalog location; the sheet has no location select any more (E-69). */
function ChooseLocation({ id }: { id: string }) {
  const { setLocation } = useCompareSelection();
  return (
    <button
      type="button"
      onClick={() => {
        setLocation(id);
      }}
    >
      {`choose ${id}`}
    </button>
  );
}

/** Sheet and main-screen timeline share the selection, as in App. */
function renderSheet() {
  onApply.mockClear();
  render(
    <CompareSelectionProvider onApply={onApply}>
      <CompareMetrics />
      <CompareSheet />
      <CompareTimeline />
      <CalculateStub />
      <ChooseLocation id="madrid" />
      <ChooseLocation id="at" />
    </CompareSelectionProvider>,
    { wrapper: AppProviders },
  );
}

describe("compare sheet (F-CALC)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the API trend for Vienna over the full catalog period", async () => {
    const fetchMock = stubApi((request) =>
      json(compareResponse(request, series())),
    );
    renderSheet();

    const card = await screen.findByTestId("trend-summary");
    expect(within(card).getByText("Vienna")).toBeDefined();
    expect(
      within(card).getByText(`+0.45 ${t("unit.degC")} ${t("trend.perDecade")}`),
    ).toBeDefined();
    expect(
      within(card).getByText(
        `[+0.30, +0.60] ${t("unit.degC")} ${t("trend.perDecade")}`,
      ),
    ).toBeDefined();
    expect(within(card).getByText("< 0.001")).toBeDefined();
    expect(
      within(card).getByText(t("trend.significance.positive_trend")),
    ).toBeDefined();
    expect(within(card).getByText("45")).toBeDefined();
    expect(within(card).getByText("1981–2025")).toBeDefined();
    expect(within(card).getByTestId("series-marker-a")).toBeDefined();

    const [request] = sentRequests(fetchMock);
    expect(request?.locations).toEqual([
      { id: "vienna", latitude: 48.21, longitude: 16.37 },
    ]);
    expect([request?.start_year, request?.end_year]).toEqual([1981, 2025]);
  });

  it("offers no location select (default Vienna) and a year slider bounded by the catalog", async () => {
    const fetchMock = stubApi((request) =>
      json(
        compareResponse(
          request,
          series({
            location:
              refId(request.locations[0]) === "madrid" ? madrid : vienna,
          }),
        ),
      ),
    );
    renderSheet();
    await screen.findByTestId("trend-summary");

    await screen.findByTestId("compare-metrics");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);

    const start = screen.getByRole("slider", { name: t("timeline.start") });
    const end = screen.getByRole("slider", { name: t("timeline.end") });
    for (const handle of [start, end]) {
      expect(handle.getAttribute("aria-valuemin")).toBe("1981");
      expect(handle.getAttribute("aria-valuemax")).toBe("2025");
    }
    expect(start.getAttribute("aria-valuetext")).toBe(
      `${t("timeline.start")} 1981`,
    );
    // Scale is the variable's available years; every 5th year is labelled.
    const timeline = screen.getByTestId("compare-timeline");
    const minor = within(timeline).getAllByTestId("year-tick");
    const major = within(timeline).getAllByTestId("year-tick-major");
    expect(minor.length + major.length).toBe(2025 - 1981 + 1);
    expect(major.map((tick) => tick.textContent)).toEqual(
      Array.from({ length: 9 }, (_, i) => String(1985 + 5 * i)),
    );
    expect(minor.every((tick) => tick.textContent === "")).toBe(true);

    // Choosing a location alone sends nothing and keeps the shown result.
    fireEvent.click(screen.getByRole("button", { name: "choose madrid" }));
    expect(sentRequests(fetchMock)).toHaveLength(1);
    expect(
      within(screen.getByTestId("trend-summary")).getByText("Vienna"),
    ).toBeDefined();

    // CALCULATE analyses location and period together.
    fireEvent.keyDown(start, { key: "PageUp" });
    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    await vi.waitFor(() => {
      expect(sentRequests(fetchMock)).toHaveLength(2);
    });
    const last = sentRequests(fetchMock).at(-1);
    expect(last?.locations.map(refId)).toEqual(["madrid"]);
    expect([last?.start_year, last?.end_year]).toEqual([1991, 2025]);
    await vi.waitFor(() => {
      expect(
        within(screen.getByTestId("trend-summary")).getByText("Madrid"),
      ).toBeDefined();
    });
  });

  it("moves the handles by keyboard and sends start_year/end_year only via CALCULATE", async () => {
    const fetchMock = stubApi((request) =>
      json(compareResponse(request, series())),
    );
    renderSheet();
    await screen.findByTestId("trend-summary");
    const start = screen.getByRole("slider", { name: t("timeline.start") });
    const end = screen.getByRole("slider", { name: t("timeline.end") });

    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(start, { key: "PageUp" });
    expect(start.getAttribute("aria-valuenow")).toBe("1993");
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(end.getAttribute("aria-valuenow")).toBe("2024");
    expect(end.getAttribute("aria-valuetext")).toBe(
      `${t("timeline.end")} 2024`,
    );

    // Handles never cross: End on the start handle stops at the end handle.
    fireEvent.keyDown(start, { key: "End" });
    expect(start.getAttribute("aria-valuenow")).toBe("2024");
    fireEvent.keyDown(start, { key: "Home" });
    expect(start.getAttribute("aria-valuenow")).toBe("1981");
    fireEvent.keyDown(start, { key: "PageUp" });

    // Moving alone sends nothing.
    expect(sentRequests(fetchMock)).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    await vi.waitFor(() => {
      expect(sentRequests(fetchMock)).toHaveLength(2);
    });
    const last = sentRequests(fetchMock).at(-1);
    expect([last?.start_year, last?.end_year]).toEqual([1991, 2024]);
    expect(onApply).toHaveBeenCalledTimes(1); // App opens the sheet here
  });

  it("keeps the range within max_years_per_request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/v1/catalog") {
          const c = catalog("demo");
          return Promise.resolve(
            json({
              ...c,
              year_bounds: { ...c.year_bounds, max_years_per_request: 30 },
            }),
          );
        }
        return Promise.resolve(json(compareResponse(bodyOf(init), series())));
      }),
    );
    renderSheet();
    const start = await screen.findByRole("slider", {
      name: t("timeline.start"),
    });
    const end = screen.getByRole("slider", { name: t("timeline.end") });
    expect(start.getAttribute("aria-valuenow")).toBe("1996");
    fireEvent.keyDown(start, { key: "Home" });
    expect(start.getAttribute("aria-valuenow")).toBe("1981");
    expect(end.getAttribute("aria-valuenow")).toBe("2010");
  });

  it("shows no trend number for trend=null / insufficient_data", async () => {
    stubApi((request) =>
      json(
        compareResponse(
          request,
          series({
            trend: null,
            quality: { ...series().quality, status: "insufficient_data" },
          }),
          { comparison: { common_years: [], warnings: ["insufficient_data"] } },
        ),
      ),
    );
    renderSheet();
    const card = await screen.findByTestId("trend-summary");
    expect(within(card).getByText(t("trend.insufficientData"))).toBeDefined();
    expect(within(card).queryByText(t("trend.slope"))).toBeNull();
    expect(
      within(card).queryByText(t("unit.degC"), { exact: false }),
    ).toBeNull();
  });

  it("shows a hint for missing_baseline", async () => {
    stubApi((request) =>
      json(
        compareResponse(
          request,
          series({
            quality: {
              ...series().quality,
              baseline_status: "missing_baseline",
            },
          }),
        ),
      ),
    );
    renderSheet();
    const card = await screen.findByTestId("trend-summary");
    expect(within(card).getByText(t("trend.missingBaseline"))).toBeDefined();
  });

  it("keeps the demo banner in demo mode and hides it in live mode", async () => {
    stubApi((request) => json(compareResponse(request, series())));
    renderSheet();
    await screen.findByTestId("trend-summary");
    expect(screen.getByText(t("compare.demoBanner")).getAttribute("role")).toBe(
      "status",
    );
  });

  it("shows no demo banner in live mode", async () => {
    stubApi(
      (request) =>
        json(compareResponse(request, series(), { data_mode: "live" })),
      "live",
    );
    renderSheet();
    await screen.findByTestId("trend-summary");
    expect(screen.queryByText(t("compare.demoBanner"))).toBeNull();
  });

  it("shows a stale hint for stale cached results", async () => {
    stubApi((request) =>
      json(compareResponse(request, series(), { cache_status: "stale" })),
    );
    renderSheet();
    await screen.findByTestId("trend-summary");
    expect(screen.getByText(t("compare.stale"))).toBeDefined();
  });

  it("shows the stale hint once while the selection differs from the shown result", async () => {
    stubApi((request) =>
      json(compareResponse(request, series(), { cache_status: "stale" })),
    );
    renderSheet();
    await screen.findByTestId("trend-summary");
    const start = screen.getByRole("slider", { name: t("timeline.start") });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    // Stale cache and changed selection share the key: shown only once.
    expect(screen.getAllByText(t("compare.stale"))).toHaveLength(1);
  });

  it("shows the stale hint as a toast that closes by its X and fades after 3 s (UI-DESIGN-4)", async () => {
    stubApi((request) => json(compareResponse(request, series())));
    renderSheet();
    await screen.findByTestId("trend-summary");
    expect(screen.queryByTestId("toast")).toBeNull();
    const start = screen.getByRole("slider", { name: t("timeline.start") });

    fireEvent.keyDown(start, { key: "ArrowRight" });
    const toast = screen.getByTestId("toast");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.textContent).toContain(t("compare.stale"));
    expect(
      within(screen.getByTestId("compare-sheet-result")).queryByText(
        t("compare.stale"),
      ),
    ).toBeNull();
    // Still stale: no second toast on further changes.
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(screen.getAllByTestId("toast")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: t("toast.close") }));
    expect(screen.queryByTestId("toast")).toBeNull();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(screen.queryByTestId("toast")).toBeNull();

    // A new occurrence (back to the shown period, then away again) shows it again for 3 s.
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(screen.queryByTestId("toast")).toBeNull();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(screen.getByTestId("toast").getAttribute("data-phase")).toBe(
      "enter",
    );
    await vi.waitFor(
      () => {
        expect(screen.getByTestId("toast").getAttribute("data-phase")).toBe(
          "leave",
        );
      },
      { timeout: 4000 },
    );
    await vi.waitFor(() => {
      expect(screen.queryByTestId("toast")).toBeNull();
    });
  }, 10000);

  it("marks the result as stale when location or period differ, until CALCULATE is pressed", async () => {
    stubApi((request) =>
      json(
        compareResponse(
          request,
          series({
            location:
              refId(request.locations[0]) === "madrid" ? madrid : vienna,
          }),
        ),
      ),
    );
    renderSheet();
    await screen.findByTestId("trend-summary");
    expect(screen.queryByText(t("compare.stale"))).toBeNull();

    const start = screen.getByRole("slider", { name: t("timeline.start") });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    // UI-DESIGN-4: a toast (role=status) at the bottom edge, not a banner at the chart.
    expect(
      screen.getByText(t("compare.stale")).closest('[role="status"]'),
    ).toBe(screen.getByTestId("toast"));
    fireEvent.keyDown(start, { key: "ArrowLeft" }); // back to the shown period
    expect(screen.queryByText(t("compare.stale"))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "choose madrid" }));
    expect(screen.getByText(t("compare.stale"))).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    await vi.waitFor(() => {
      expect(
        within(screen.getByTestId("trend-summary")).getByText("Madrid"),
      ).toBeDefined();
    });
    expect(screen.queryByText(t("compare.stale"))).toBeNull();
  });

  it("announces errors and retries on request", async () => {
    let fail = true;
    stubApi((request) =>
      fail ? json(errorBody, 503) : json(compareResponse(request, series())),
    );
    renderSheet();
    expect((await screen.findByRole("alert")).textContent).toBe(
      t("compare.error"),
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("compare.retry") }));
    expect(await screen.findByTestId("trend-summary")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a neutral message for 500 and 502, never the API body text (UI-ERR)", async () => {
    const leak = "LEAK_SERVER_MESSAGE_XYZ";
    const details = "LEAK_SERVER_DETAILS_XYZ";
    const body: ErrorResponse = {
      error: {
        code: "INTERNAL_ERROR",
        message: leak,
        request_id: "q",
        retryable: true,
        details: { info: details },
      },
    };
    for (const status of [500, 502]) {
      stubApi(() => json(body, status));
      renderSheet();
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(t("error.server"));
      expect(alert.textContent).not.toContain(leak);
      expect(document.body.textContent).not.toContain(leak);
      expect(document.body.textContent).not.toContain(details);
      cleanup();
    }
  });
});

function SliderHarness({ initial }: { initial: YearRange }) {
  const [value, setValue] = useState(initial);
  return (
    <YearRangeSlider
      label="range"
      startLabel="start"
      endLabel="end"
      scaleMin={1950}
      scaleMax={2030}
      min={1981}
      max={2025}
      value={value}
      onChange={setValue}
    />
  );
}

describe("YearRangeSlider stacking", () => {
  function handles() {
    return {
      start: screen.getByRole("slider", { name: "start" }),
      end: screen.getByRole("slider", { name: "end" }),
    };
  }
  const onTop = (el: HTMLElement) =>
    el.classList.contains("year-slider__handle--top");

  it("puts the last moved handle on top when both meet", () => {
    render(<SliderHarness initial={{ start: 2000, end: 2001 }} />);
    const { start, end } = handles();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect([
      start.getAttribute("aria-valuenow"),
      end.getAttribute("aria-valuenow"),
    ]).toEqual(["2001", "2001"]);
    expect(onTop(start)).toBe(true);
    expect(onTop(end)).toBe(false);

    fireEvent.keyDown(end, { key: "ArrowLeft" }); // blocked by the start handle, but moved last
    expect(end.getAttribute("aria-valuenow")).toBe("2001");
    expect(onTop(end)).toBe(true);
    expect(onTop(start)).toBe(false);
  });

  it("keeps the start handle on top when both sit at max_year, so it can move left", () => {
    render(<SliderHarness initial={{ start: 2024, end: 2025 }} />);
    const { start, end } = handles();
    fireEvent.keyDown(end, { key: "End" });
    fireEvent.keyDown(start, { key: "End" });
    fireEvent.keyDown(end, { key: "End" }); // end moved last, start still on top at max
    expect(start.getAttribute("aria-valuenow")).toBe("2025");
    expect(onTop(start)).toBe(true);
    expect(onTop(end)).toBe(false);

    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(start.getAttribute("aria-valuenow")).toBe("2024");
  });
});

describe("variable, locations and area mean from the catalog (UI-AT)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const optionLabels = (select: HTMLElement) =>
    within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);

  it("hides precipitation in the variable dropdown in demo mode", async () => {
    stubApi((request) => json(compareResponse(request, series())), "demo");
    renderSheet();
    await screen.findByTestId("trend-summary");
    const variable = screen.getByLabelText(t("compare.variable"));
    expect(optionLabels(variable)).not.toContain(
      "Precipitation (bias corrected)",
    );
  });

  it("lists enabled catalog variables; CALCULATE sends the variable", async () => {
    const fetchMock = stubApi(
      (request) => json(compareResponse(request, series())),
      "live",
    );
    renderSheet();
    await screen.findByTestId("trend-summary");

    const variable = screen.getByLabelText(t("compare.variable"));
    expect(optionLabels(variable).slice(0, 2)).toEqual([
      "Air temperature at 2 m",
      "Precipitation (bias corrected)",
    ]);
    expect(optionLabels(variable)).toContain(t("extremes.metric.hot_days"));
    expect((variable as HTMLSelectElement).value).toBe("temperature_2m");
    expect(sentRequests(fetchMock)[0]?.variable_id).toBe("temperature_2m");

    // Choosing a variable alone sends nothing and marks the result as stale.
    fireEvent.change(variable, { target: { value: "precipitation" } });
    expect(sentRequests(fetchMock)).toHaveLength(1);
    expect(screen.getByText(t("compare.stale"))).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    await vi.waitFor(() => {
      expect(sentRequests(fetchMock)).toHaveLength(2);
    });
    expect(sentRequests(fetchMock)[1]?.variable_id).toBe("precipitation");
    // Unit of the variable the response was computed for, unconverted.
    const card = await screen.findByText(
      `+0.45 ${t("unit.mm_year")} ${t("trend.perDecade")}`,
    );
    expect(card).toBeDefined();
  });
});

describe("area-mean note by spatial method (UI-AREAMEAN)", () => {
  function withMethod(
    spatialMethod: SeriesResult["provenance"]["spatial_method"],
  ): SeriesResult {
    const base = series();
    return {
      ...base,
      provenance: { ...base.provenance, spatial_method: spatialMethod },
    };
  }

  function renderBoth(entry: SeriesResult) {
    const summary = render(<TrendSummary series={entry} unit="degC" />);
    const verdict = render(<TrendVerdict series={entry} unit="degC" />);
    return { summary, verdict };
  }

  it("shows the grid text for area_weighted_grid", () => {
    const text = t("trend.areaMean.grid");
    renderBoth(withMethod("area_weighted_grid"));
    expect(
      within(screen.getByTestId("trend-summary")).getByRole("note").textContent,
    ).toBe(text);
    expect(
      within(screen.getByTestId("trend-verdict")).getByRole("note").textContent,
    ).toBe(text);
  });

  it("shows the states text for area_weighted_states", () => {
    const text = t("trend.areaMean.states");
    renderBoth(withMethod("area_weighted_states"));
    expect(
      within(screen.getByTestId("trend-summary")).getByRole("note").textContent,
    ).toBe(text);
    expect(
      within(screen.getByTestId("trend-verdict")).getByRole("note").textContent,
    ).toBe(text);
  });

  it("shows no note for a grid point, null, or capital_point", () => {
    for (const method of [undefined, null, "capital_point"] as const) {
      const { summary, verdict } = renderBoth(withMethod(method));
      expect(
        within(screen.getByTestId("trend-summary")).queryByRole("note"),
      ).toBeNull();
      expect(
        within(screen.getByTestId("trend-verdict")).queryByRole("note"),
      ).toBeNull();
      summary.unmount();
      verdict.unmount();
    }
  });
});

describe("TrendSummary units (UI-UNIT)", () => {
  const slopeAndInterval = () => {
    const card = screen.getByTestId("trend-summary");
    const values = within(card).getAllByRole("definition");
    return [values[0]?.textContent, values[1]?.textContent];
  };

  it("shows degC and mm/year via unit keys, with a per-decade suffix", () => {
    const { unmount } = render(<TrendSummary series={series()} unit="degC" />);
    expect(slopeAndInterval()).toEqual([
      `+0.45 ${t("unit.degC")} ${t("trend.perDecade")}`,
      `[+0.30, +0.60] ${t("unit.degC")} ${t("trend.perDecade")}`,
    ]);
    unmount();

    render(<TrendSummary series={series()} unit="mm/year" />);
    expect(slopeAndInterval()).toEqual([
      `+0.45 ${t("unit.mm_year")} ${t("trend.perDecade")}`,
      `[+0.30, +0.60] ${t("unit.mm_year")} ${t("trend.perDecade")}`,
    ]);
  });

  it("falls back to the raw catalog unit when no key exists", () => {
    render(<TrendSummary series={series()} unit="W/m2" />);
    expect(slopeAndInterval()).toEqual([
      `+0.45 W/m2 ${t("trend.perDecade")}`,
      `[+0.30, +0.60] W/m2 ${t("trend.perDecade")}`,
    ]);
  });
});

describe("TrendSummary short_period note (D-05)", () => {
  it("shows the note only when the API sets the short_period flag", () => {
    const { unmount } = render(
      <TrendSummary
        series={series({
          trend: { ...trend, diagnostic_flags: ["short_period"] },
        })}
        unit="degC"
      />,
    );
    expect(screen.getByRole("note").textContent).toBe(t("trend.shortPeriod"));
    unmount();

    render(<TrendSummary series={series()} unit="degC" />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(t("trend.shortPeriod"))).toBeNull();
  });
});

describe("map selection (UI-SEL)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const villach = {
    kind: "area",
    id: "villach",
    name: "Villach",
    centroid: [13.8361, 46.6112], // GeoJSON [lon, lat]
  } as const;

  it("turns a GeoJSON centroid [lon, lat] into lat/lon", () => {
    expect(placeFromPick(catalog("live"), villach)).toEqual({
      kind: "point",
      lat: 46.6112,
      lon: 13.8361,
      label: "Villach",
    });
    // No centroid in Natural Earth: centre of the outline, also [lon, lat].
    const square = {
      type: "Polygon",
      coordinates: [
        [
          [10, 40],
          [12, 40],
          [12, 41],
          [10, 41],
          [10, 40],
        ],
      ],
    } as const;
    expect(
      placeFromPick(catalog("live"), {
        kind: "state",
        iso: "US-CO",
        name: "Colorado",
        geometry: square,
      }),
    ).toEqual({ kind: "point", lat: 40.5, lon: 11, label: "Colorado" });
  });

  it("prefers a catalog location (country by label, state by catalog id)", () => {
    const withStates: CatalogResponse = {
      ...catalog("live"),
      locations: [
        ...catalog("live").locations,
        {
          id: "at-kaernten",
          label: "Carinthia",
          latitude: 46.62,
          longitude: 14.31,
          spatial_kind: "grid_point",
        },
      ],
    };
    const outline = {
      type: "Polygon",
      coordinates: [
        [
          [13, 46],
          [15, 46],
          [15, 47],
          [13, 46],
        ],
      ],
    } as const;
    expect(
      placeFromPick(withStates, {
        kind: "country",
        name: "Austria",
        geometry: outline,
      }),
    ).toEqual({ kind: "catalog", id: "at" });
    expect(
      placeFromPick(withStates, {
        kind: "state",
        iso: "AT-2",
        name: "Kärnten",
        geometry: outline,
      }),
    ).toEqual({ kind: "catalog", id: "at-kaernten" });
  });

  it("maps a US state by ISO 3166-2 and the USA country to the catalog entry", () => {
    const outline = {
      type: "Polygon",
      coordinates: [
        [
          [13, 46],
          [15, 46],
          [15, 47],
          [13, 46],
        ],
      ],
    } as const;
    const texas = {
      id: "us-tx",
      label: "Texas",
      latitude: 31.43,
      longitude: -99.28,
      spatial_kind: "region" as const,
    };
    const usa = {
      id: "usa",
      label: "United States",
      latitude: 39.83,
      longitude: -98.58,
      spatial_kind: "region" as const,
    };
    const withUs: CatalogResponse = {
      ...catalog("live"),
      locations: [...catalog("live").locations, texas, usa],
    };
    expect(
      placeFromPick(withUs, {
        kind: "state",
        iso: "US-TX",
        name: "Texas",
        geometry: outline,
      }),
    ).toEqual({ kind: "catalog", id: "us-tx" });
    expect(
      placeFromPick(withUs, {
        kind: "country",
        name: "United States",
        geometry: outline,
      }),
    ).toEqual({ kind: "catalog", id: "usa" });
    expect(
      placeFromPick(withUs, {
        kind: "country",
        name: "United States of America",
        geometry: outline,
      }),
    ).toEqual({ kind: "catalog", id: "usa" });
    expect(COMPARE_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
  });

  function PickVillach() {
    const { pickOnMap } = useCompareSelection();
    return (
      <button
        type="button"
        onClick={() => {
          pickOnMap(villach);
        }}
      >
        pick
      </button>
    );
  }

  it("a pick sets the location without a request; CALCULATE sends a PointRef", async () => {
    const fetchMock = stubApi((request) =>
      json(compareResponse(request, series())),
    );
    render(
      <CompareSelectionProvider>
        <CompareMetrics />
        <CompareSheet />
        <CompareTimeline />
        <CalculateStub />
        <PickVillach />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    await screen.findByTestId("trend-summary");
    expect(sentRequests(fetchMock)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(sentRequests(fetchMock)).toHaveLength(1);
    expect(screen.getByText(t("compare.stale"))).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    await vi.waitFor(() => {
      expect(sentRequests(fetchMock)).toHaveLength(2);
    });
    expect(sentRequests(fetchMock)[1]?.locations).toEqual([
      { kind: "point", lat: 46.6112, lon: 13.8361, label: "Villach" },
    ]);
  });

  it("offers usa as a catalog location in the selection", async () => {
    const withUsa: CatalogResponse = {
      ...catalog("live"),
      locations: [
        ...catalog("live").locations,
        {
          id: "usa",
          label: "United States",
          latitude: 39.83,
          longitude: -98.58,
          spatial_kind: "region",
        },
        {
          id: "us-tx",
          label: "Texas",
          latitude: 31.43,
          longitude: -99.28,
          spatial_kind: "region",
        },
      ],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/catalog") return Promise.resolve(json(withUsa));
      if (url === "/api/v1/compare" && typeof init?.body === "string") {
        return Promise.resolve(
          json(
            compareResponse(JSON.parse(init.body) as CompareRequest, series()),
          ),
        );
      }
      if (isExtremesUrl(url)) return Promise.resolve(json(minimalExtremes()));
      return Promise.resolve(json({}, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    function DraftPlace() {
      const { draft, setLocation } = useCompareSelection();
      const id = draft?.place.kind === "catalog" ? draft.place.id : "none";
      return (
        <>
          <span data-testid="draft-place">{id}</span>
          <button
            type="button"
            onClick={() => {
              setLocation("usa");
            }}
          >
            choose usa
          </button>
          <button
            type="button"
            onClick={() => {
              setLocation("us-tx");
            }}
          >
            choose us-tx
          </button>
        </>
      );
    }
    render(
      <CompareSelectionProvider>
        <DraftPlace />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    await vi.waitFor(() => {
      expect(screen.getByTestId("draft-place").textContent).toBe("vienna");
    });
    fireEvent.click(screen.getByRole("button", { name: "choose usa" }));
    expect(screen.getByTestId("draft-place").textContent).toBe("usa");
    fireEvent.click(screen.getByRole("button", { name: "choose us-tx" }));
    expect(screen.getByTestId("draft-place").textContent).toBe("us-tx");
  });
});

describe("series chart (UI-CHART)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a chart of annual observations and the trend line", async () => {
    stubApi((request) =>
      json(
        compareResponse(
          request,
          series({
            observations_annual: [
              { year: 1981, value: 5, valid_months: 12, expected_months: 12 },
              { year: 1982, value: null, valid_months: 0, expected_months: 12 },
              { year: 1983, value: 6, valid_months: 12, expected_months: 12 },
              { year: 2019, value: 7, valid_months: 12, expected_months: 12 },
              { year: 2020, value: 7.2, valid_months: 12, expected_months: 12 },
              { year: 2021, value: 7.1, valid_months: 12, expected_months: 12 },
              { year: 2022, value: 8, valid_months: 12, expected_months: 12 },
              { year: 2023, value: 8.1, valid_months: 12, expected_months: 12 },
              { year: 2024, value: 8.5, valid_months: 12, expected_months: 12 },
              { year: 2025, value: 8.2, valid_months: 12, expected_months: 12 },
            ],
            trend: {
              ...trend,
              n_years: 9,
              start_year: 1981,
              end_year: 2025,
              trend_line: [
                { year: 1981, value: 5.1 },
                { year: 1982, value: 5.5 },
                { year: 1983, value: 5.9 },
                { year: 2019, value: 7.0 },
                { year: 2020, value: 7.2 },
                { year: 2021, value: 7.4 },
                { year: 2022, value: 7.6 },
                { year: 2023, value: 7.8 },
                { year: 2024, value: 8.0 },
                { year: 2025, value: 8.2 },
              ],
            },
          }),
        ),
      ),
    );
    renderSheet();
    const chart = await screen.findByTestId("series-chart");
    expect(
      within(chart).getByText("Air temperature at 2 m · Vienna"),
    ).toBeDefined();
    expect(
      within(chart).getByText(t("chart.legend.observations")),
    ).toBeDefined();
    expect(within(chart).getByText(t("chart.legend.trend"))).toBeDefined();
    const curves = [...chart.querySelectorAll(".recharts-line-curve")];
    expect(curves).toHaveLength(2);
    const commands = (d: string | null) => d?.match(/[ML][^ML]*/g) ?? [];
    // 1982 is a real null (gap); 2019-2025 stay connected through to the last year.
    expect(commands(curves[0]?.getAttribute("d") ?? null)).toHaveLength(9);
    expect(commands(curves[1]?.getAttribute("d") ?? null)).toHaveLength(10);
    expect(curves[0]?.getAttribute("stroke-dasharray")).toBeNull();

    // UI-DESIGN-3: the title is only the figure's hidden caption; the info button shows it on
    // hover and on focus, described by the tooltip; Esc closes it.
    const select = screen.getByLabelText(t("compare.variable"));
    expect(select.closest(".chart-tools")).not.toBeNull();
    const info = screen.getByRole("button", { name: t("chart.info") });
    const tooltip = screen.getByTestId("chart-info-tooltip");
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    expect(info.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.hidden).toBe(true);
    expect(tooltip.textContent).toContain("Air temperature at 2 m · Vienna");
    fireEvent.mouseEnter(info);
    expect(tooltip.hidden).toBe(false);
    fireEvent.mouseLeave(info);
    expect(tooltip.hidden).toBe(true);
    fireEvent.focus(info);
    expect(tooltip.hidden).toBe(false);
    fireEvent.keyDown(info, { key: "Escape" });
    expect(tooltip.hidden).toBe(true);
  });
});
