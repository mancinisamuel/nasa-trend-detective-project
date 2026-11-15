import { fireEvent, render, screen, within } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../src/app/providers";
import { SidePanel } from "../src/app/SidePanel";
import type { MapPick } from "../src/components/globeLevels";
import {
  CompareSelectionProvider,
  useCompareSelection,
} from "../src/features/compare/CompareSelection";
import { CompareMetrics } from "../src/features/compare/CompareMetrics";
import { CompareSheet } from "../src/features/compare/CompareSheet";
import { CompareTimeline } from "../src/features/compare/CompareTimeline";
import type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
  SeriesResult,
  TrendResult,
} from "../src/features/compare/contract";
import type { RegionResponse } from "../src/features/region/contract";
import { TrendVerdict } from "../src/features/evidence/TrendVerdict";
import { RegionSidebar } from "../src/features/region/RegionSidebar";
import { StateMapView } from "../src/features/region/StateMapView";
import { t } from "../src/i18n";
import { isExtremesUrl, minimalExtremes } from "./extremes-stub";

const vienna = {
  id: "vienna",
  label: "Vienna",
  latitude: 48.21,
  longitude: 16.37,
  spatial_kind: "grid_point",
} as const;

const catalog: CatalogResponse = {
  data_mode: "demo",
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
  locations: [vienna],
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

const trend: TrendResult = {
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

const series: SeriesResult = {
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
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function compareResponse(request: CompareRequest): CompareResponse {
  return {
    schema_version: "1.0",
    analysis_version: "annual-ols-hac-v1",
    result_id: "r",
    request_id: "q",
    data_mode: "demo",
    cache_status: "miss",
    generated_at: "2026-11-14T13:00:00Z",
    request,
    series: [series],
    comparison: { common_years: [], warnings: [] },
  };
}

function square(
  west: number,
  south: number,
  east: number,
  north: number,
): RegionResponse["boundary"] {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

const regionMeta: RegionResponse["metadata"] = {
  provider: "geoBoundaries",
  release_type: "gbOpen",
  attribution: "test",
  license: "test",
  url: "https://example.test",
  layers: [],
  retrieved_at: "2026-11-14T13:00:00Z",
  simplification: "test",
};

const travis = {
  id: "travis",
  name: "Travis",
  centroid: [-97.7431, 30.2672],
  geometry: square(-98, 30, -97, 31),
};

const harris = {
  id: "harris",
  name: "Harris",
  centroid: [-95.3698, 29.7604],
  geometry: square(-96, 29, -95, 30),
};

const texas: RegionResponse = {
  country_iso3: "USA",
  adm1_id: "US-TX",
  name: "Texas",
  boundary: square(-106, 25, -93, 37),
  // Two counties: a single district is dropped (Wien, US-DC; E-47).
  districts: [travis, harris],
  municipalities: [],
  metadata: regionMeta,
};

function bodyOf(init: RequestInit | undefined): CompareRequest {
  if (typeof init?.body !== "string") throw new Error("expected a JSON body");
  return JSON.parse(init.body) as CompareRequest;
}

function sentCompare(
  fetchMock: ReturnType<typeof stubTexas>,
): CompareRequest[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/v1/compare")
    .map(([, init]) => bodyOf(init));
}

function stubTexas() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/catalog") return Promise.resolve(json(catalog));
    if (url === "/api/v1/regions/USA/US-TX")
      return Promise.resolve(json(texas));
    if (url === "/api/v1/compare" && typeof init?.body === "string") {
      return Promise.resolve(
        json(compareResponse(JSON.parse(init.body) as CompareRequest)),
      );
    }
    if (isExtremesUrl(url)) return Promise.resolve(json(minimalExtremes()));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const texasOutline = square(-106, 25, -93, 37);

function TexasMap() {
  const { pickOnMap } = useCompareSelection();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const onPick = useCallback(
    (pick: MapPick) => {
      if (pick.kind === "area") setHighlightedId(pick.id);
      pickOnMap(pick);
    },
    [pickOnMap],
  );
  return (
    <>
      <StateMapView
        country="USA"
        adm1="US-TX"
        name="Texas"
        outline={texasOutline}
        surroundings={[]}
        highlightedId={highlightedId}
        onPick={onPick}
      />
      <RegionSidebar
        continent="North America"
        countryName="United States of America"
        country="USA"
        adm1="US-TX"
        name="Texas"
        highlightedId={highlightedId}
        onHighlight={setHighlightedId}
        onPick={onPick}
      />
      <CompareMetrics />
      <CompareSheet />
    </>
  );
}

describe("state map county selection (UI-CNTY)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a click on a Texas county sets the location, highlight and sidebar without a request", async () => {
    const fetchMock = stubTexas();
    render(
      <CompareSelectionProvider>
        <TexasMap />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    await screen.findByTestId("trend-summary");
    const map = await screen.findByTestId("state-map");
    const county = await vi.waitFor(() => {
      const path = map.querySelector('[data-id="travis"]');
      if (path === null) throw new Error("Travis county path missing");
      return path;
    });
    expect(sentCompare(fetchMock)).toHaveLength(1);

    fireEvent.click(county);
    // The location changed (no select any more, E-69): the shown result is marked as stale.
    expect(screen.getByText(t("compare.stale"))).toBeDefined();
    expect(screen.getByTestId("state-map-highlight")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Travis" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(sentCompare(fetchMock)).toHaveLength(1);
  });
});

/** Same side panel wiring as App: list of the open state, selected entry, results. */
function TexasPanel() {
  const { draft, pickOnMap } = useCompareSelection();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const onPick = useCallback(
    (pick: MapPick) => {
      if (pick.kind === "area") setHighlightedId(pick.id);
      pickOnMap(pick);
    },
    [pickOnMap],
  );
  const cityName =
    highlightedId !== null && draft?.place.kind === "point"
      ? draft.place.label
      : null;
  return (
    <>
      <SidePanel
        parentPick={{
          kind: "state",
          iso: "US-TX",
          name: "Texas",
          geometry: texasOutline,
        }}
        renderRegion={(hidden) => (
          <RegionSidebar
            hidden={hidden}
            continent="North America"
            countryName="United States of America"
            country="USA"
            adm1="US-TX"
            name="Texas"
            highlightedId={highlightedId}
            onHighlight={setHighlightedId}
            onPick={onPick}
          />
        )}
        cityName={cityName}
        onChangeLocation={() => {
          setHighlightedId(null);
        }}
        resultsReady
      />
      <CompareTimeline />
    </>
  );
}

function calculateFor(name: string): string {
  return t("result.calculateFor").replace("{name}", name);
}

describe("floating side panel states A/B/C (UI-DESIGN-7)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A: list only; B: list stays, entry marked, Calculate for <entry>; X back to A; Calculate for <state>; C: only the entry with results; Change location: back to A", async () => {
    const fetchMock = stubTexas();
    render(
      <CompareSelectionProvider>
        <TexasPanel />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    const panel = screen.getByTestId("side-panel");
    // Full height comes from the class (top and bottom inset in global.css).
    expect(panel.classList.contains("app-layout__side--fill")).toBe(true);

    // A: state with its list and "Calculate for Texas", no entry card, no results.
    const travis = await within(panel).findByRole("button", { name: "Travis" });
    expect(panel.getAttribute("data-state")).toBe("state");
    const sidebar = within(panel).getByTestId("region-sidebar");
    expect(sidebar.hidden).toBe(false);
    expect(within(panel).queryByTestId("city-result-card")).toBeNull();
    expect(within(panel).queryByTestId("compare-metrics")).toBeNull();
    expect(
      within(panel).getByRole("button", { name: calculateFor("Texas") }),
    ).toBeDefined();
    // The timeline has no CALCULATE any more.
    expect(
      within(screen.getByTestId("compare-timeline")).queryByRole("button", {
        name: t("timeline.calculate"),
      }),
    ).toBeNull();

    // B: the list stays, the entry is marked, its card offers "Calculate for Travis".
    fireEvent.click(travis);
    expect(panel.getAttribute("data-state")).toBe("selected");
    expect(sidebar.hidden).toBe(false);
    expect(travis.getAttribute("aria-pressed")).toBe("true");
    const card = within(panel).getByTestId("city-result-card");
    expect(
      within(card).getByRole("button", { name: calculateFor("Travis") }),
    ).toBeDefined();
    expect(within(panel).queryByText(t("result.calculateHint"))).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: t("result.changeLocation") }),
    ).toBeNull();
    // B shows only the entry's button, not the state's.
    expect(
      within(panel).queryByRole("button", { name: calculateFor("Texas") }),
    ).toBeNull();

    // The X in the entry's line removes the selection: back to A with the state's button.
    fireEvent.click(
      within(card).getByRole("button", { name: t("toast.close") }),
    );
    expect(panel.getAttribute("data-state")).toBe("state");
    expect(within(panel).queryByTestId("city-result-card")).toBeNull();
    expect(travis.getAttribute("aria-pressed")).toBe("false");
    expect(
      within(panel).getByRole("button", { name: calculateFor("Texas") }),
    ).toBeDefined();
    fireEvent.click(travis);
    expect(travis.getAttribute("aria-pressed")).toBe("true");

    // Another entry switches the selection and the button.
    fireEvent.click(within(sidebar).getByRole("button", { name: "Harris" }));
    expect(
      within(sidebar)
        .getByRole("button", { name: "Harris" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(travis.getAttribute("aria-pressed")).toBe("false");
    const sentBefore = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/v1/compare",
    ).length;
    fireEvent.click(
      within(panel).getByRole("button", { name: calculateFor("Harris") }),
    );

    // C: only the calculated entry on top, Change location, the trend once and the records.
    await within(panel).findByTestId("trend-verdict");
    await within(panel).findAllByTestId("extremes-record");
    expect(panel.getAttribute("data-state")).toBe("calculated");
    expect(sentCompare(fetchMock).length).toBeGreaterThan(sentBefore);
    const last = sentCompare(fetchMock).at(-1);
    expect(last?.locations[0]).toMatchObject({
      kind: "point",
      label: "Harris",
    });
    expect([last?.start_year, last?.end_year]).toEqual([1981, 2025]);
    expect(within(panel).getByTestId("region-sidebar").hidden).toBe(true);
    expect(panel.firstElementChild).toBe(
      within(panel).getByTestId("city-result-card"),
    );
    expect(within(panel).getAllByTestId("trend-verdict")).toHaveLength(1);
    expect(within(panel).queryByTestId("trend-summary")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: calculateFor("Harris") }),
    ).toBeNull();

    // UI-DESIGN-15: a new period for the calculated place brings the button back as orange
    // "Recalculate for Harris"; it sends the same request with the new period.
    const startField = within(screen.getByTestId("compare-timeline")).getByRole(
      "textbox",
      { name: t("timeline.start") },
    );
    fireEvent.change(startField, { target: { value: "1990" } });
    fireEvent.blur(startField);
    const recalc = within(panel).getByRole("button", {
      name: t("result.recalculateFor").replace("{name}", "Harris"),
    });
    expect(recalc.classList.contains("result-card__calculate")).toBe(true);
    expect(
      recalc.classList.contains("result-card__calculate--recalculate"),
    ).toBe(true);
    expect(
      within(panel).queryByRole("button", { name: calculateFor("Harris") }),
    ).toBeNull();
    fireEvent.click(recalc);
    await vi.waitFor(() => {
      expect(sentCompare(fetchMock).at(-1)?.start_year).toBe(1990);
    });
    expect(sentCompare(fetchMock).at(-1)?.locations[0]).toMatchObject({
      kind: "point",
      label: "Harris",
    });
    expect(
      within(panel).queryByRole("button", {
        name: t("result.recalculateFor").replace("{name}", "Harris"),
      }),
    ).toBeNull();
    expect(panel.getAttribute("data-state")).toBe("calculated");

    // Change location: back to A with the list; results leave the panel.
    fireEvent.click(
      within(panel).getByRole("button", { name: t("result.changeLocation") }),
    );
    expect(panel.getAttribute("data-state")).toBe("state");
    expect(within(panel).getByTestId("region-sidebar").hidden).toBe(false);
    expect(within(panel).queryByTestId("city-result-card")).toBeNull();
    expect(within(panel).queryByTestId("compare-metrics")).toBeNull();
    expect(
      within(panel)
        .getByRole("button", { name: "Harris" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    // "Calculate for Texas": a point at the centre of the state outline, labelled with its name
    // (the contract has no region target).
    fireEvent.click(
      within(panel).getByRole("button", { name: calculateFor("Texas") }),
    );
    await vi.waitFor(() => {
      expect(sentCompare(fetchMock).at(-1)?.locations[0]).toEqual({
        kind: "point",
        lat: 31,
        lon: -99.5,
        label: "Texas",
      });
    });
    expect(panel.getAttribute("data-state")).toBe("calculated");
    const stateCard = within(panel).getByTestId("city-result-card");
    expect(panel.firstElementChild).toBe(stateCard);
    expect(within(stateCard).getByRole("heading").textContent).toBe("Texas");
    expect(within(panel).getByTestId("region-sidebar").hidden).toBe(true);
    await within(panel).findByTestId("trend-verdict");
    fireEvent.click(
      within(panel).getByRole("button", { name: t("result.changeLocation") }),
    );
    expect(panel.getAttribute("data-state")).toBe("state");
    expect(within(panel).getByTestId("region-sidebar").hidden).toBe(false);
    expect(
      within(panel).getByRole("button", { name: calculateFor("Texas") }),
    ).toBeDefined();
  });
});

describe("side panel on the country level (UI-DESIGN-9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a country without regions shows only its Calculate, which sends a point at its centre; Change location returns", async () => {
    const fetchMock = stubTexas();
    render(
      <CompareSelectionProvider>
        <SidePanel
          parentPick={{
            kind: "country",
            name: "Testland",
            geometry: square(10, 40, 20, 50),
          }}
          renderRegion={null}
          cityName={null}
          onChangeLocation={() => {}}
          resultsReady
        />
        <CompareTimeline />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    const panel = screen.getByTestId("side-panel");
    expect(within(panel).queryByTestId("country-sidebar")).toBeNull();
    expect(within(panel).queryByTestId("compare-metrics")).toBeNull();
    const button = await within(panel).findByRole("button", {
      name: t("result.calculateFor").replace("{name}", "Testland"),
    });
    await vi.waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(sentCompare(fetchMock).at(-1)?.locations[0]).toEqual({
        kind: "point",
        lat: 45,
        lon: 15,
        label: "Testland",
      });
    });
    expect(panel.getAttribute("data-state")).toBe("calculated");
    expect(
      within(within(panel).getByTestId("city-result-card")).getByRole("heading")
        .textContent,
    ).toBe("Testland");
    fireEvent.click(
      within(panel).getByRole("button", { name: t("result.changeLocation") }),
    );
    expect(panel.getAttribute("data-state")).toBe("state");
  });
});

describe("highlighted trend figure (UI-DESIGN-10)", () => {
  it("shows the trend per decade as the headline with direction and API significance", () => {
    render(<TrendVerdict series={series} unit="degC" />, {
      wrapper: AppProviders,
    });
    const hero = screen
      .getByTestId("trend-verdict")
      .querySelector(".trend-hero");
    expect(hero?.getAttribute("data-direction")).toBe("up");
    expect(hero?.getAttribute("data-status")).toBe("positive_trend");
    expect(hero?.querySelector("dt")?.textContent).toBe(t("trend.slope"));
    expect(hero?.querySelector("dd")?.textContent).toContain("0.45");
    // The verdict badge keeps the existing text of the API significance.
    expect(
      screen
        .getByTestId("trend-verdict")
        .querySelector(".trend-verdict__box")
        ?.getAttribute("data-status"),
    ).toBe("positive_trend");
  });
});
