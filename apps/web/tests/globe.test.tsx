import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  type ForwardedRef,
} from "react";
import type { GlobeProps } from "react-globe.gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import admin1AutRaw from "../public/geo/admin1/AUT.json?raw";
import admin1DeuRaw from "../public/geo/admin1/DEU.json?raw";
import countriesRaw from "../public/geo/countries.json?raw";
import { App } from "../src/app/App";
import { AppLayout } from "../src/components/layout/AppLayout";
import type { CatalogResponse } from "../src/features/compare/contract";
import { AppProviders } from "../src/app/providers";
import { EarthGlobe } from "../src/components/EarthGlobe";
import {
  countriesInView,
  labelPoint,
  pathData,
  project,
  projectionForCountry,
} from "../src/components/countryProjection";
import {
  cameraForContinent,
  cameraForLevel,
  globePolygons,
  globeReducer,
  NASA_HQ_START_VIEW,
  INITIAL_LEVEL,
  levelFromQuery,
  levelPath,
  longitudeSpan,
  regionsForCountry,
  type CountryFeature,
  type GlobeLevel,
  type RegionFeature,
} from "../src/components/globeLevels";
import { t } from "../src/i18n";

const countries = (JSON.parse(countriesRaw) as { features: CountryFeature[] })
  .features;
const austrianRegions = (
  JSON.parse(admin1AutRaw) as { features: RegionFeature[] }
).features;

function country(code: string): CountryFeature {
  const found = countries.find((c) => c.properties.ADM0_A3 === code);
  if (!found) throw new Error(`missing ${code}`);
  return found;
}

function continent(name: string): CountryFeature[] {
  return countries.filter((c) => c.properties.CONTINENT === name);
}

describe("globe data (Natural Earth, reduced)", () => {
  it("drops 'Seven seas (open ocean)' and keeps Antarctica", () => {
    const continents = new Set(countries.map((c) => c.properties.CONTINENT));
    expect(continents.has("Seven seas (open ocean)")).toBe(false);
    expect(continents.has("Antarctica")).toBe(true);
  });

  it("keeps all 234 countries, each with at least one polygon with coordinates", () => {
    // Dropping small islands must never drop a whole country (Malta, Singapore, Pacific states).
    expect(countries).toHaveLength(234);
    for (const feature of countries) {
      const { geometry } = feature;
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.coordinates;
      const hasRing = polygons.some((polygon) =>
        polygon.some((ring) => ring.length >= 4),
      );
      expect(hasRing, feature.properties.ADM0_A3).toBe(true);
    }
    expect(country("MLT")).toBeDefined();
    expect(country("SGP")).toBeDefined();
  });

  it("has exactly the 9 Austrian states, keyed by ADM0_A3", () => {
    expect(austrianRegions).toHaveLength(9);
    expect(austrianRegions.map((r) => r.properties.name)).toContain("Wien");
    expect(austrianRegions.every((r) => r.properties.adm0_a3 === "AUT")).toBe(
      true,
    );
  });
});

describe("globe level reducer", () => {
  it("goTo jumps to a level above the current one and ignores the rest (E-35)", () => {
    const austria: GlobeLevel = {
      kind: "regions",
      continent: "Europe",
      country: "AUT",
      previous: "DEU",
    };
    expect(levelPath(austria).map((level) => level.kind)).toEqual([
      "continents",
      "countries",
      "regions",
    ]);
    expect(globeReducer(austria, { type: "goTo", depth: 1 })).toEqual({
      kind: "countries",
      continent: "Europe",
    });
    expect(globeReducer(austria, { type: "goTo", depth: 0 })).toEqual(
      INITIAL_LEVEL,
    );
    // The current level and anything outside the path change nothing.
    expect(globeReducer(austria, { type: "goTo", depth: 2 })).toBe(austria);
    expect(globeReducer(austria, { type: "goTo", depth: 5 })).toBe(austria);
    expect(globeReducer(austria, { type: "goTo", depth: -1 })).toBe(austria);
    const europe: GlobeLevel = { kind: "countries", continent: "Europe" };
    expect(globeReducer(europe, { type: "goTo", depth: 0 })).toEqual(
      INITIAL_LEVEL,
    );
  });

  it("walks continent -> country -> region level and back", () => {
    let level: GlobeLevel = INITIAL_LEVEL;
    level = globeReducer(level, {
      type: "selectContinent",
      continent: "Europe",
    });
    expect(level).toEqual({ kind: "countries", continent: "Europe" });
    level = globeReducer(level, { type: "selectCountry", country: "AUT" });
    expect(level).toEqual({
      kind: "regions",
      continent: "Europe",
      country: "AUT",
    });
    level = globeReducer(level, { type: "back" });
    expect(level).toEqual({ kind: "countries", continent: "Europe" });
    level = globeReducer(level, { type: "back" });
    expect(level).toEqual(INITIAL_LEVEL);
    expect(globeReducer(level, { type: "back" })).toEqual(INITIAL_LEVEL);
  });

  it("switches from one country map straight to a neighbour's, Back still goes to the globe", () => {
    const austria: GlobeLevel = {
      kind: "regions",
      continent: "Europe",
      country: "AUT",
    };
    const turkey = globeReducer(austria, {
      type: "switchCountry",
      continent: "Asia",
      country: "TUR",
    });
    expect(turkey).toEqual({
      kind: "regions",
      continent: "Asia",
      country: "TUR",
      previous: "AUT",
    });
    expect(globeReducer(turkey, { type: "back" })).toEqual({
      kind: "countries",
      continent: "Asia",
    });
    // Antarctica is not selectable; switching is only possible from a country map.
    expect(
      globeReducer(austria, {
        type: "switchCountry",
        continent: "Antarctica",
        country: "ATA",
      }),
    ).toBe(austria);
    const europe: GlobeLevel = { kind: "countries", continent: "Europe" };
    expect(
      globeReducer(europe, {
        type: "switchCountry",
        continent: "Europe",
        country: "DEU",
      }),
    ).toBe(europe);
  });

  it("resets to the continent level from anywhere", () => {
    const deep: GlobeLevel = {
      kind: "regions",
      continent: "Europe",
      country: "AUT",
    };
    expect(globeReducer(deep, { type: "reset" })).toEqual(INITIAL_LEVEL);
  });

  it("ignores Antarctica and out-of-order selections", () => {
    expect(
      globeReducer(INITIAL_LEVEL, {
        type: "selectContinent",
        continent: "Antarctica",
      }),
    ).toEqual(INITIAL_LEVEL);
    expect(
      globeReducer(INITIAL_LEVEL, { type: "selectCountry", country: "AUT" }),
    ).toEqual(INITIAL_LEVEL);
    const regions: GlobeLevel = {
      kind: "regions",
      continent: "Europe",
      country: "AUT",
    };
    expect(
      globeReducer(regions, { type: "selectCountry", country: "DEU" }),
    ).toBe(regions);
  });

  it("reads the development start level from the query", () => {
    expect(levelFromQuery("?globe=Europe/AUT")).toEqual({
      kind: "regions",
      continent: "Europe",
      country: "AUT",
    });
    expect(levelFromQuery("?globe=Europe")).toEqual({
      kind: "countries",
      continent: "Europe",
    });
    expect(levelFromQuery("?globe=Antarctica")).toEqual(INITIAL_LEVEL);
    expect(levelFromQuery("")).toEqual(INITIAL_LEVEL);
  });
});

describe("polygon selection per level", () => {
  it("level 1 shows every country (drawn as continent surfaces)", () => {
    expect(globePolygons(null, countries)).toHaveLength(countries.length);
  });

  it("level 2 (and the globe behind the level-3 map) shows only the continent's countries", () => {
    const shown = globePolygons("Europe", countries);
    expect(shown.length).toBeGreaterThan(30);
    expect(shown.every((c) => c.properties.CONTINENT === "Europe")).toBe(true);
  });

  it("level 3 shows only the chosen country's regions", () => {
    const foreign: RegionFeature = {
      type: "Feature",
      properties: { name: "Bayern", adm0_a3: "DEU", iso_3166_2: "DE-BY" },
      geometry: { type: "Polygon", coordinates: [] },
    };
    expect(
      regionsForCountry("AUT", [...austrianRegions, foreign]),
    ).toHaveLength(9);
  });
});

describe("fixed camera per level", () => {
  it("starts on NASA Headquarters, Washington DC, close enough for the earth to fill the stage", () => {
    expect(NASA_HQ_START_VIEW.lat).toBeCloseTo(38.883, 3);
    expect(NASA_HQ_START_VIEW.lng).toBeCloseTo(-77.016, 3);
    expect(NASA_HQ_START_VIEW.altitude).toBe(1.6);
  });

  it("level 1 is the NASA HQ start view", () => {
    expect(cameraForLevel(INITIAL_LEVEL, countries)).toEqual(
      NASA_HQ_START_VIEW,
    );
  });

  it("Europe as a continent is centred on central Europe (Russia left out of the camera)", () => {
    const camera = cameraForContinent(continent("Europe"));
    expect(camera.lng).toBeGreaterThan(0);
    expect(camera.lng).toBeLessThan(25);
    expect(camera.lat).toBeGreaterThan(42);
    expect(camera.lat).toBeLessThan(60);
    expect(camera.altitude).toBeLessThan(1.2);
  });

  it("level 3 keeps the continent camera behind the 2D map", () => {
    expect(
      cameraForLevel(
        { kind: "regions", continent: "Europe", country: "AUT" },
        countries,
      ),
    ).toEqual(cameraForContinent(continent("Europe")));
  });

  it("longitude span takes the short way across the antimeridian", () => {
    expect(longitudeSpan([179, -179]).width).toBe(2);
    expect(longitudeSpan([170, -170, 175]).west).toBe(170);
  });
});

describe("label on the previously selected country", () => {
  it("sits on the visible part of a neighbour cut by the frame", () => {
    // Germany's map shows only the north of Austria; the label must land there, inside the frame.
    const { projection, viewBox } = projectionForCountry(country("DEU"));
    const [x, y] = labelPoint(projection, country("AUT").geometry, viewBox);
    expect(x).toBeGreaterThanOrEqual(viewBox.x);
    expect(x).toBeLessThanOrEqual(viewBox.x + viewBox.width);
    expect(y).toBeGreaterThanOrEqual(viewBox.y);
    expect(y).toBeLessThanOrEqual(viewBox.y + viewBox.height);
    // y is -latitude: the anchor is north of Austria's own centre (about 47.6 N).
    expect(-y).toBeGreaterThan(47.6);
  });
});

describe("flat 2D projection of a country", () => {
  function frame(code: string) {
    return projectionForCountry(country(code));
  }

  it("is flat: equal latitude gives equal y, equal longitude gives equal x", () => {
    const { projection } = frame("AUT");
    expect(project(projection, [10, 47])[1]).toBe(
      project(projection, [16, 47])[1],
    );
    expect(project(projection, [13, 46])[0]).toBe(
      project(projection, [13, 49])[0],
    );
  });

  it("Austria keeps its real proportions (longitude scaled by cos of mid latitude)", () => {
    const { viewBox } = frame("AUT");
    const ratio = viewBox.width / viewBox.height;
    // 7.6° x cos(47.7°) ≈ 5.1 wide, 2.65° high ≈ 1.94; the padding pulls it a little towards 1.
    // Without the cos factor it would be ≈ 2.9.
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.1);
  });

  it("France is framed on the mainland, without French Guiana", () => {
    const { projection, viewBox } = frame("FRA");
    expect(projection.centerLng).toBeGreaterThan(-5);
    expect(projection.centerLng).toBeLessThan(8);
    expect(viewBox.height).toBeLessThan(12);
  });

  it("Russia stays in one piece across the antimeridian", () => {
    const { projection, viewBox } = frame("RUS");
    expect(projection.centerLng).toBeGreaterThan(60);
    expect(projection.centerLng).toBeLessThan(140);
    // Chukotka at -175° lies east of the frame centre, not 280° to the west
    expect(project(projection, [-175, 65])[0]).toBeGreaterThan(0);
    expect(viewBox.width).toBeLessThan(180);
    const russia = pathData(projection, country("RUS").geometry);
    expect(russia).not.toContain("NaN");
  });

  it("draws Austria's neighbours around it, not Austria itself and not far-away countries", () => {
    const { projection, viewBox } = projectionForCountry(country("AUT"));
    const shown = countriesInView(projection, viewBox, countries, "AUT").map(
      (c) => c.properties.ADM0_A3,
    );
    for (const code of ["DEU", "CHE", "ITA", "CZE", "SVK", "HUN", "SVN"]) {
      expect(shown).toContain(code);
    }
    expect(shown).not.toContain("AUT");
    expect(shown).not.toContain("ESP");
    expect(shown).not.toContain("USA");
  });

  it("Fiji is framed at the antimeridian, not across the whole world", () => {
    const { projection, viewBox } = frame("FJI");
    expect(Math.abs(projection.centerLng)).toBeGreaterThan(170);
    expect(viewBox.width).toBeLessThan(10);
  });
});

// --- Component with a mocked react-globe.gl (jsdom has no WebGL) ---

type CapturedProps = GlobeProps;
const captured: { props: CapturedProps | null } = { props: null };
const controls = { enableZoom: true };
const pointOfView = vi.fn();
const pauseAnimation = vi.fn();
const resumeAnimation = vi.fn();
// The starfield (E-62) adds itself to the scene and reads prefers-reduced-motion; jsdom has neither.
const scene = { add: vi.fn(), remove: vi.fn() };
window.matchMedia = () => ({ matches: false }) as MediaQueryList;

vi.mock("react-globe.gl", () => ({
  default: forwardRef(function MockGlobe(
    props: CapturedProps,
    ref: ForwardedRef<unknown>,
  ) {
    captured.props = props;
    useImperativeHandle(ref, () => ({
      controls: () => controls,
      scene: () => scene,
      pointOfView,
      pauseAnimation,
      resumeAnimation,
    }));
    const { onGlobeReady } = props;
    useEffect(() => {
      onGlobeReady?.();
    }, [onGlobeReady]);
    return <div data-testid="globe-canvas" />;
  }),
}));

/** The back tile next to the 2D map (E-55); its name starts with "Back to globe". */
function backToGlobeButton(): HTMLElement {
  return screen.getByRole("button", {
    name: (name) => name.startsWith(t("globe.backToGlobe")),
  });
}

function polygons(): CountryFeature[] {
  return (captured.props?.polygonsData ?? []) as CountryFeature[];
}

function click(feature: object) {
  const handler = captured.props?.onPolygonClick;
  if (!handler) throw new Error("no click handler");
  act(() => {
    handler(feature, new MouseEvent("click"), { lat: 0, lng: 0, altitude: 0 });
  });
}

describe("EarthGlobe with WebGL (mocked globe)", () => {
  beforeEach(() => {
    captured.props = null;
    controls.enableZoom = true;
    pointOfView.mockClear();
    pauseAnimation.mockClear();
    resumeAnimation.mockClear();
    vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {
      // presence is all hasWebGL() checks
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as RenderingContext,
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            url.endsWith("countries.json")
              ? countriesRaw
              : url.endsWith("admin1/AUT.json")
                ? admin1AutRaw
                : url.endsWith("admin1/DEU.json")
                  ? admin1DeuRaw
                  : '{"type":"FeatureCollection","features":[]}',
            { status: url.endsWith(".json") ? 200 : 404 },
          ),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderLoaded() {
    render(<EarthGlobe />);
    await screen.findByTestId("globe-canvas");
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
  }

  it("disables zoom and opens on NASA HQ without attribution texts", async () => {
    await renderLoaded();
    // onGlobeReady runs in an effect; wait for it instead of racing it (seen flaky once).
    await vi.waitFor(() => {
      expect(controls.enableZoom).toBe(false);
    });
    // The very first camera is NASA HQ, set without a swing.
    await vi.waitFor(() => {
      expect(pointOfView).toHaveBeenCalledTimes(1);
    });
    expect(pointOfView).toHaveBeenCalledWith(NASA_HQ_START_VIEW, 0);
    // E-32: the credits stay in the README, not on the map or globe.
    expect(screen.queryByText(/Natural Earth/)).toBeNull();
    expect(screen.queryByText(/Blue Marble/)).toBeNull();
    expect(document.querySelector(".earth-globe__attribution")).toBeNull();
  });

  it("goes back to the continents with an animated move to NASA HQ", async () => {
    await renderLoaded();
    await vi.waitFor(() => {
      expect(pointOfView).toHaveBeenCalledTimes(1);
    });
    click(country("AUT"));
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(continent("Europe").length);
    });
    fireEvent.click(screen.getByTestId("globe-back"));
    // The switch to the globe view follows the loader by two animation frames (UI-DESIGN-2).
    await vi.waitFor(() => {
      expect(pointOfView).toHaveBeenLastCalledWith(NASA_HQ_START_VIEW, 1000);
    });
  });

  it("navigates Europe -> Austria (2D map) and back to the globe", async () => {
    await renderLoaded();
    // E-56: level 1 draws the outlines too, in the continent colours.
    expect(captured.props?.pathsData?.length).toBeGreaterThan(0);

    click(country("AUT")); // on level 1 a click selects the country's continent
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(continent("Europe").length);
    });
    expect(polygons().every((c) => c.properties.CONTINENT === "Europe")).toBe(
      true,
    );
    expect(pointOfView).toHaveBeenLastCalledWith(
      cameraForContinent(continent("Europe")),
      1000,
    );
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    expect(captured.props?.pathsData?.length).toBeGreaterThanOrEqual(
      continent("Europe").length,
    );

    // Level 3: the 2D map shows exactly the 9 states; the globe keeps Europe and pauses.
    pointOfView.mockClear();
    click(country("AUT"));
    const map = await screen.findByRole("group", {
      name: t("globe.countryMap.ariaLabel"),
    });
    await vi.waitFor(() => {
      expect(map.querySelectorAll(".country-map__region")).toHaveLength(9);
    });
    expect(map.querySelector('[data-map-tooltip="Wien"]')).not.toBeNull();
    expect(polygons()).toHaveLength(continent("Europe").length);
    expect(pauseAnimation).toHaveBeenCalled();
    expect(pointOfView).not.toHaveBeenCalled();
    expect(backToGlobeButton()).toBeDefined();

    // Esc: back to the globe with the continent's countries.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    expect(resumeAnimation).toHaveBeenCalled();
    expect(polygons()).toHaveLength(continent("Europe").length);

    // On the globe the back tile leads back to the continents (after the loader is painted).
    fireEvent.click(screen.getByTestId("globe-back"));
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
    expect(screen.queryByTestId("globe-path")).toBeNull();
  });

  it("clicking a faint neighbour opens its own map; Back still goes to the globe", async () => {
    await renderLoaded();
    click(country("AUT"));
    click(country("AUT"));
    const map = await screen.findByTestId("country-map");
    await vi.waitFor(() => {
      expect(map.querySelectorAll(".country-map__region")).toHaveLength(9);
    });
    // First open: no previous country, so no label.
    expect(screen.queryByTestId("previous-label")).toBeNull();
    expect(screen.queryByText(t("map.previouslySelected"))).toBeNull();
    const germany = screen.getByRole("button", {
      name: `Germany: ${t("globe.countryMap.showNeighbor")}`,
    });
    expect(map.querySelector('[data-country="CHE"]')).not.toBeNull();
    expect(map.querySelector('[data-country="ITA"]')).not.toBeNull();

    fireEvent.click(germany);
    await vi.waitFor(() => {
      expect(map.querySelectorAll(".country-map__region")).toHaveLength(16);
    });
    expect(map.querySelector('[data-map-tooltip="Bayern"]')).not.toBeNull();
    expect(map.querySelector('[data-map-tooltip="Wien"]')).toBeNull();
    expect(screen.getByTestId("globe-path").textContent).toContain("Germany");
    // Austria is now a neighbour itself, styled apart from the other neighbours.
    const austria = map.querySelector('[data-country="AUT"]');
    expect(
      austria?.classList.contains("country-map__neighbour--previous"),
    ).toBe(true);
    expect(
      map.querySelectorAll(".country-map__neighbour--previous"),
    ).toHaveLength(1);
    expect(
      map
        .querySelector('[data-country="CHE"]')
        ?.classList.contains("country-map__neighbour--previous"),
    ).toBe(false);
    // ... and labelled once, inside the map.
    const labels = screen.getAllByText(t("map.previouslySelected"));
    expect(labels).toHaveLength(1);
    expect(labels[0]?.tagName.toLowerCase()).toBe("text");
    expect(map.contains(labels[0] ?? null)).toBe(true);

    // Only the immediately previous country: after Germany -> Poland, Germany is marked, not Austria.
    fireEvent.click(
      screen.getByRole("button", {
        name: `Poland: ${t("globe.countryMap.showNeighbor")}`,
      }),
    );
    await vi.waitFor(() => {
      expect(screen.getByTestId("globe-path").textContent).toContain("Poland");
    });
    const marked = [
      ...map.querySelectorAll(".country-map__neighbour--previous"),
    ].map((path) => path.getAttribute("data-country"));
    expect(marked).toEqual(["DEU"]);

    fireEvent.click(backToGlobeButton());
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    expect(polygons()).toHaveLength(continent("Europe").length);
  });

  it("has no Back or Reset buttons; the path is the only way back, one level per click", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    click(country("FRA"));
    click(country("FRA"));
    await screen.findByTestId("country-map");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.getByTestId("globe-path").textContent).toContain(
      "Europe / France",
    );

    fireEvent.click(backToGlobeButton());
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(polygons()).toHaveLength(continent("Europe").length);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    const path = screen.getByRole("button", {
      name: (name) => name.startsWith(t("globe.back")),
    });
    expect(path.getAttribute("aria-label")).toBe(`${t("globe.back")}: Europe`);
    expect(screen.getByTestId("globe-path").textContent).toContain("Europe");
    fireEvent.click(path);
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
  });

  it("the globe card has no results handle", async () => {
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    expect(
      screen.queryByRole("button", { name: t("layout.sheetHandle") }),
    ).toBeNull();
    expect(screen.queryByTestId("results")).toBeNull();
  });

  it("layout without a country: search bar, no side panel", async () => {
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    expect(
      screen.getByRole("combobox", { name: t("search.ariaLabel") }),
    ).toBeDefined();
    expect(screen.queryByText(t("layout.sidePanel"))).toBeNull();
    expect(screen.getByTestId("app-layout").getAttribute("data-panel")).toBe(
      "closed",
    );
  });

  it("layout with a country: side panel with its states (UI-DESIGN-9); the path leads back", async () => {
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    // UI-DESIGN-9: the side panel opens on the country map: country, its states, and
    // "Calculate for <country>" before a state is marked.
    const panel = screen.getByTestId("side-panel");
    expect(screen.getByTestId("app-layout").getAttribute("data-panel")).toBe(
      "open",
    );
    expect(panel.getAttribute("data-state")).toBe("state");
    const list = within(panel).getByTestId("country-sidebar");
    expect(
      within(list).getByRole("heading", { level: 2 }).textContent,
    ).toContain("Austria");
    expect(await within(list).findAllByRole("listitem")).toHaveLength(9);
    const calculateFor = (name: string) =>
      t("result.calculateFor").replace("{name}", name);
    expect(
      within(panel).getByRole("button", { name: calculateFor("Austria") }),
    ).toBeDefined();
    // UI-DESIGN-11: one click on a state in the list opens it at once: no mark, no X,
    // no "Open state". The panel shows the state with its places and its Calculate.
    fireEvent.click(within(list).getByRole("button", { name: "Tirol" }));
    const statePanel = await screen.findByTestId("region-sidebar");
    expect(screen.queryByTestId("country-sidebar")).toBeNull();
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(screen.getByTestId("globe-path").textContent).toContain("Tirol");
    expect(statePanel.textContent).toContain("Tirol");
    const tirolPanel = screen.getByTestId("side-panel");
    expect(tirolPanel.getAttribute("data-state")).toBe("state");
    expect(
      within(tirolPanel).getByRole("button", { name: calculateFor("Tirol") }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: t("region.countryMap.openState") }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t("toast.close") })).toBeNull();
    // One level up: the country again, with only "Calculate for <country>".
    fireEvent.click(
      screen.getByRole("button", {
        name: (name) => name.startsWith(t("globe.back")),
      }),
    );
    const map = await screen.findByTestId("country-map");
    const countryPanel = screen.getByTestId("side-panel");
    expect(
      within(countryPanel).getByRole("button", {
        name: calculateFor("Austria"),
      }),
    ).toBeDefined();
    expect(within(countryPanel).queryByTestId("city-result-card")).toBeNull();
    // A click on a state in the map opens it the same way.
    const carinthia = map.querySelector('[data-region="AT-2"]');
    expect(carinthia).not.toBeNull();
    fireEvent.click(carinthia as Element);
    await screen.findByTestId("region-sidebar");
    expect(screen.getByTestId("globe-path").textContent).toContain("Kärnten");
    expect(
      screen.getByRole("button", { name: calculateFor("Kärnten") }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: (name) => name.startsWith(t("globe.back")),
      }),
    );
    await screen.findByTestId("country-map");
    const path = backToGlobeButton();
    expect(screen.getByTestId("globe-path").textContent).toContain(
      "Europe / Austria",
    );

    fireEvent.click(path);
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(screen.queryByTestId("side-panel")).toBeNull();
    expect(screen.getByTestId("app-layout").getAttribute("data-panel")).toBe(
      "closed",
    );
    // Search bar stays in both states.
    expect(
      screen.getByRole("combobox", { name: t("search.ariaLabel") }),
    ).toBeDefined();
  });

  it("the search icon leads to the outermost globe view and focuses the search field (UI-DESIGN-3)", async () => {
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    expect(
      screen.queryByRole("combobox", { name: t("search.ariaLabel") }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("layout.search") }));
    // Same way as the back tile and the path: the loader shows at once.
    expect(screen.getByTestId("globe-loading")).toBeDefined();
    const search = await screen.findByRole("combobox", {
      name: t("search.ariaLabel"),
    });
    expect(
      screen.getByRole("heading", { name: t("globe.level.continents") }),
    ).toBeDefined();
    expect(polygons()).toHaveLength(countries.length);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
  });

  it("the timeline sits at the bottom of the globe card", async () => {
    const geoFetch = vi.mocked(fetch);
    const catalog: CatalogResponse = {
      data_mode: "demo",
      variables: [],
      locations: [],
      year_bounds: {
        min_year: 1981,
        max_year: 2025,
        max_years_per_request: 50,
      },
      default_baseline: { start_year: 1991, end_year: 2020 },
      method: {
        analysis_version: "v",
        method: "ols_hac",
        description: "",
        min_years: 30,
        hac_maxlags: 3,
        confidence_level: 0.95,
        slope_unit: "per_decade",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/v1/catalog"
          ? Promise.resolve(new Response(JSON.stringify(catalog)))
          : geoFetch(url),
      ),
    );
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    const main = screen.getByTestId("main-area");
    // UI-DESIGN-12: no timeline on the globe and continent views; the stage keeps the card.
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
    expect(screen.queryByTestId("compare-timeline")).toBeNull();
    expect(screen.queryByTestId("timeline-dock")).toBeNull();
    click(country("AUT"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("globe-path").textContent).toContain("Europe");
    });
    expect(screen.queryByTestId("compare-timeline")).toBeNull();
    // From the country level on it fades in, in the floating dock.
    click(country("AUT"));
    await screen.findByTestId("country-map");
    expect(
      screen
        .getByTestId("timeline-dock")
        .contains(await screen.findByTestId("compare-timeline")),
    ).toBe(true);
    // The period lives in the selection: hiding and showing the timeline keeps it.
    const startField = () =>
      within(
        screen.getByTestId("compare-timeline"),
      ).getByRole<HTMLInputElement>("textbox", { name: t("timeline.start") });
    fireEvent.change(startField(), { target: { value: "1995" } });
    fireEvent.blur(startField());
    expect(startField().value).toBe("1995");
    fireEvent.click(backToGlobeButton());
    await vi.waitFor(() => {
      expect(screen.queryByTestId("compare-timeline")).toBeNull();
    });
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    await screen.findByTestId("compare-timeline");
    expect(startField().value).toBe("1995");
    expect(screen.getByTestId("app-layout").getAttribute("data-results")).toBe(
      "closed",
    );
    const card = main.querySelector(".app-layout__card");
    expect(card?.contains(screen.getByTestId("compare-timeline"))).toBe(true);
    expect(screen.queryByTestId("results")).toBeNull();
  });

  it("the timeline has no CALCULATE button any more (UI-DESIGN-7)", async () => {
    const geoFetch = vi.mocked(fetch);
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
      locations: [
        {
          id: "vienna",
          label: "Vienna",
          latitude: 48.21,
          longitude: 16.37,
          spatial_kind: "grid_point",
        },
      ],
      year_bounds: {
        min_year: 1981,
        max_year: 2025,
        max_years_per_request: 50,
      },
      default_baseline: { start_year: 1991, end_year: 2020 },
      method: {
        analysis_version: "v",
        method: "ols_hac",
        description: "",
        min_years: 30,
        hac_maxlags: 3,
        confidence_level: 0.95,
        slope_unit: "per_decade",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/v1/catalog"
          ? Promise.resolve(new Response(JSON.stringify(catalog)))
          : geoFetch(url),
      ),
    );
    render(<App />, { wrapper: AppProviders });
    await screen.findByTestId("globe-canvas");
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(countries.length);
    });
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    const timeline = await screen.findByTestId("compare-timeline");
    const layout = screen.getByTestId("app-layout");
    const card = screen
      .getByTestId("main-area")
      .querySelector(".app-layout__card");
    expect(card?.contains(timeline)).toBe(true);
    expect(layout.getAttribute("data-results")).toBe("closed");
    // UI-DESIGN-7: CALCULATE moved from the timeline into the side panel ("Calculate for <place>",
    // see state-map.test.tsx); without a selected entry there is nothing to calculate here.
    expect(
      screen.queryByRole("button", { name: t("timeline.calculate") }),
    ).toBeNull();
  });

  it("open results collapse the globe; the chevron and the search icon expand it again", () => {
    const onExpandGlobe = vi.fn();
    render(
      <AppLayout
        panelOpen={false}
        heading="h"
        resultsOpen
        results={<div>results</div>}
        timeline={<div>timeline</div>}
        onExpandGlobe={onExpandGlobe}
        onSearchIconClick={() => {}}
      >
        <div />
      </AppLayout>,
      { wrapper: AppProviders },
    );
    const layout = screen.getByTestId("app-layout");
    expect(layout.getAttribute("data-results")).toBe("open");
    expect(screen.getByTestId("results").hidden).toBe(false);
    // UI-DESIGN-12: timeline and results are one floating dock, not two cards.
    const dock = screen.getByTestId("timeline-dock");
    expect(dock.contains(screen.getByText("timeline"))).toBe(true);
    expect(dock.contains(screen.getByTestId("results"))).toBe(true);
    // UI-DESIGN-13: the collapse button sits on the card (docked above its corner), not in the
    // timeline strip.
    const collapse = screen.getByRole("button", {
      name: t("layout.expandGlobe"),
    });
    expect(collapse.parentElement).toBe(dock);
    expect(
      dock.querySelector(".app-layout__timeline")?.contains(collapse),
    ).toBe(false);
    fireEvent.click(collapse);
    expect(onExpandGlobe).toHaveBeenCalledTimes(1);
    // E-52e: a click on the collapsed search icon expands the globe again.
    fireEvent.click(screen.getByRole("button", { name: t("layout.search") }));
    expect(onExpandGlobe).toHaveBeenCalledTimes(2);
  });

  it("the collapse button shows only while the results are open (UI-DESIGN-13)", () => {
    render(
      <AppLayout
        panelOpen={false}
        heading="h"
        resultsOpen={false}
        results={<div>results</div>}
        timeline={<div>timeline</div>}
        onExpandGlobe={() => {}}
      >
        <div />
      </AppLayout>,
      { wrapper: AppProviders },
    );
    expect(screen.getByText("timeline")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: t("layout.expandGlobe") }),
    ).toBeNull();
  });

  it("plays the entry animation only when the country level opens from the globe (UI-DESIGN-14)", () => {
    vi.useFakeTimers();
    const layout = (countryLevel: boolean, content: string) => (
      <AppLayout
        panelOpen={countryLevel}
        heading="h"
        countryLevel={countryLevel}
        panelContent={<div className="app-layout__side">{content}</div>}
        resultsOpen={false}
        timeline={<div>timeline</div>}
        onExpandGlobe={() => {}}
      >
        <div />
      </AppLayout>
    );
    const { rerender } = render(layout(false, "none"), {
      wrapper: AppProviders,
    });
    const main = screen.getByTestId("app-layout");
    expect(main.getAttribute("data-enter")).toBeNull();
    // Globe or continent -> country: side panel, dock and map animate in.
    rerender(layout(true, "Austria"));
    expect(main.getAttribute("data-enter")).toBe("country");
    // Cleared once the dock (the last step) has arrived; jsdom plays no animations, so the
    // fallback timer clears it.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(main.getAttribute("data-enter")).toBeNull();
    // Country -> state inside: the panel stays, no new entry.
    rerender(layout(true, "Tirol"));
    expect(main.getAttribute("data-enter")).toBeNull();
    // Back to the globe and in again: plays again.
    rerender(layout(false, "none"));
    expect(main.getAttribute("data-enter")).toBeNull();
    rerender(layout(true, "Austria"));
    expect(main.getAttribute("data-enter")).toBe("country");
    vi.useRealTimers();
  });

  it("path segments jump straight to their level; the current one is plain text (E-35)", async () => {
    await renderLoaded();
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    const chip = screen.getByTestId("globe-path");
    expect(chip.textContent).toContain(
      `${t("globe.path.globe")} / Europe / Austria`,
    );
    const current = chip.querySelector('[aria-current="location"]');
    expect(current?.textContent).toBe("Austria");
    expect(current?.tagName.toLowerCase()).not.toBe("button");
    expect(current?.closest("button")).toBeNull();
    // Clicking the current segment (or the chip around it) changes nothing.
    if (current) fireEvent.click(current);
    fireEvent.click(chip);
    expect(screen.getByTestId("country-map")).toBeDefined();

    // "Europe" -> countries level.
    fireEvent.click(screen.getByRole("button", { name: "Europe" }));
    expect(screen.queryByTestId("country-map")).toBeNull();
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    expect(polygons()).toHaveLength(continent("Europe").length);
    expect(
      screen
        .getByTestId("globe-path")
        .querySelector('[aria-current="location"]')?.textContent,
    ).toBe("Europe");

    // Back into Austria, then "Globe" -> continents level in one click.
    click(country("AUT"));
    await screen.findByTestId("country-map");
    fireEvent.click(
      screen.getByRole("button", { name: t("globe.path.globe") }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByTestId("country-map")).toBeNull();
    });
    expect(
      screen.getByRole("heading", { name: t("globe.level.continents") }),
    ).toBeDefined();
    expect(polygons()).toHaveLength(countries.length);
    expect(screen.queryByTestId("globe-path")).toBeNull();
  });

  it("the arrow still goes back exactly one level and keeps its name (E-35)", async () => {
    await renderLoaded();
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    const arrow = screen.getByTestId("globe-back");
    expect(arrow.getAttribute("aria-label")).toBe(
      `${t("globe.backToGlobe")}: Europe / Austria`,
    );
    fireEvent.click(arrow);
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    fireEvent.click(screen.getByTestId("globe-back"));
    expect(
      await screen.findByRole("heading", {
        name: t("globe.level.continents"),
      }),
    ).toBeDefined();
  });

  it("shows 'Globe View loading...' at once on the click back to the globe view (UI-DESIGN-2)", async () => {
    await renderLoaded();
    expect(screen.queryByTestId("globe-loading")).toBeNull();
    click(country("AUT"));
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(continent("Europe").length);
    });
    // Going deeper never shows the loader.
    expect(screen.queryByTestId("globe-loading")).toBeNull();

    // Back tile: the loader is there in the same event, before the level has switched.
    fireEvent.click(screen.getByTestId("globe-back"));
    const loader = screen.getByTestId("globe-loading");
    expect(loader.getAttribute("role")).toBe("status");
    expect(loader.getAttribute("data-phase")).toBe("on");
    expect(loader.textContent).toBe(t("globe.loading"));
    expect(
      screen.getByRole("heading", { name: t("globe.level.countries") }),
    ).toBeDefined();
    const clicked = performance.now();
    // Then the globe view renders underneath while the loader stays.
    expect(
      await screen.findByRole("heading", {
        name: t("globe.level.continents"),
      }),
    ).toBeDefined();
    expect(screen.getByTestId("globe-loading")).toBeDefined();
    // It fades and goes no earlier than 1200 ms after the click.
    await vi.waitFor(
      () => {
        expect(screen.queryByTestId("globe-loading")).toBeNull();
      },
      { timeout: 3000 },
    );
    expect(performance.now() - clicked).toBeGreaterThanOrEqual(1200);

    // Path segment "Globe" from the 2D country map: also at once.
    click(country("AUT"));
    click(country("AUT"));
    await screen.findByTestId("country-map");
    expect(screen.queryByTestId("globe-loading")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("globe.path.globe") }),
    );
    expect(screen.getByTestId("globe-loading").textContent).toBe(
      t("globe.loading"),
    );
    expect(screen.getByTestId("country-map")).toBeDefined();
  }, 8000);

  it("one mouse click selects even when the globe drops it as a tiny drag (UI-DESIGN-4)", async () => {
    await renderLoaded();
    const canvas = screen.getByRole("img", { name: t("globe.ariaLabel") });
    const hover = (feature: CountryFeature | null) => {
      act(() => {
        captured.props?.onPolygonHover?.(feature, null);
      });
    };
    const mouse = (type: "down" | "up", x: number, y: number) => {
      const init = { clientX: x, clientY: y, button: 0, pointerType: "mouse" };
      if (type === "down") fireEvent.pointerDown(canvas, init);
      else fireEvent.pointerUp(canvas, init);
    };

    // A 2 px wobble: react-globe.gl calls no onPolygonClick, the fallback selects Europe.
    hover(country("AUT"));
    mouse("down", 100, 100);
    hover(null); // the globe reports no hover while it thinks it is dragged
    mouse("up", 102, 101);
    await vi.waitFor(() => {
      expect(polygons()).toHaveLength(continent("Europe").length);
    });

    // A real drag (rotation) selects nothing.
    hover(country("FRA"));
    mouse("down", 100, 100);
    mouse("up", 160, 120);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId("country-map")).toBeNull();

    // When the globe registers the click itself, it counts once (no second step).
    hover(country("FRA"));
    mouse("down", 100, 100);
    mouse("up", 100, 100);
    click(country("FRA"));
    await screen.findByTestId("country-map");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByTestId("globe-path").textContent).toContain(
      "Europe / France",
    );
  });

  it("Russia's 2D map is flat and complete", async () => {
    await renderLoaded();
    click(country("RUS"));
    click(country("RUS"));
    const map = await screen.findByTestId("country-map");
    // Only countries.json and RUS admin-1 are fetched; no admin-1 while on the globe.
    const fetched = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => url as string)
      .filter((url) => url.includes("/admin1/"));
    expect(fetched).toEqual([expect.stringContaining("admin1/RUS.json")]);
    expect(map.getAttribute("viewBox")).not.toContain("NaN");
  });

  it("Antarctica is drawn but not clickable", async () => {
    await renderLoaded();
    click(country("ATA"));
    expect(polygons()).toHaveLength(countries.length);
  });
});

describe("EarthGlobe without WebGL", () => {
  it("shows only the WebGL notice, no globe and no map", () => {
    render(<EarthGlobe />);
    expect(screen.getByRole("status").textContent).toBe(
      t("globe.webglFallback"),
    );
    expect(screen.queryByTestId("globe-canvas")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the app shows the globe stage inside the layout", () => {
    render(<App />, { wrapper: AppProviders });
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      t("app.title"),
    );
    expect(screen.getByText(t("globe.webglFallback"))).toBeDefined();
  });
});
