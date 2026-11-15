import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { GlobeMethods } from "react-globe.gl";

import { t, type MessageKey } from "../i18n";
import {
  continentHasRegionView,
  hasRegionView,
} from "../features/region/regionApi";
import { CountryMap } from "./CountryMap";
import { PathSlotContext } from "./layout/pathSlot";
import {
  borderRings,
  cameraForLevel,
  globePolygons,
  globeReducer,
  type GlobeAction,
  INITIAL_LEVEL,
  levelFromQuery,
  isCountryOrDeeper,
  levelPath,
  NON_SELECTABLE_CONTINENTS,
  openStateActions,
  regionsForCountry,
  type StateTarget,
  US,
  type CountryFeature,
  type GlobeLevel,
  type MapPick,
  type PolygonGeometry,
  type RegionFeature,
  type Ring,
} from "./globeLevels";

// three.js is large; load it only when the globe is actually shown.
const Globe = lazy(() => import("react-globe.gl"));

const GEO_BASE = `${import.meta.env.BASE_URL}geo/`;
const TEXTURE_URL = `${GEO_BASE}blue-marble-2048x1024.jpg`;
const TRANSITION_MS = 1000;
// UI-DESIGN-2: loader when returning to the globe view. It shows at least this long from the
// click, and in any case until the camera move back has ended (plus a short tail), then fades.
const GLOBE_LOADING_MIN_MS = 1200;
const GLOBE_LOADING_TAIL_MS = 100;
// Matches --globe-loading-fade in tokens.css.
const GLOBE_LOADING_FADE_MS = 250;
const POLYGON_ALTITUDE = 0.006;
// Borders are a line layer clearly above the caps (polygon strokes z-fight with them).
const BORDER_ALTITUDE = 0.009;

const LEVEL_TITLES: Record<GlobeLevel["kind"], MessageKey> = {
  continents: "globe.level.continents",
  countries: "globe.level.countries",
  regions: "globe.level.regions",
  // No own title key yet; districts and municipalities are administrative regions too.
  state: "globe.level.regions",
};

// One colour per continent, so countries of a continent read as one surface on level 1.
const CONTINENT_COLOURS: Record<string, string> = {
  Africa: "#c98a2b",
  Asia: "#b8574a",
  Europe: "#4f86b8",
  "North America": "#5c9e6b",
  "South America": "#8e6bb0",
  Oceania: "#2f9c9c",
  Antarctica: "#d9e2e6",
};
const FALLBACK_COLOUR = "#7a8790";
const SIDE_COLOUR = "rgba(0, 0, 0, 0.15)";
const NO_STROKE = () => null;
// E-56/E-60: on level 1 the continents are a light wash with clear lines in their own colour; the
// hovered continent is half coloured. Hover only changes fills, never a line (E-61).
const CONTINENT_FILL_ALPHA = 0.15;
const CONTINENT_HOVER_ALPHA = 0.5;

// Hovered country (E-59/E-60): a see-through fill in a stronger shade of the continent colour,
// so the satellite image stays visible.
const HOVER_FILL_ALPHA = 0.55;
// Level 2 (E-57/E-60): countries filled in their continent's colour at 15 %, outlined thick in a
// lighter shade of it so the line stays visible (three-globe fat lines: width in pixels).
const COUNTRY_FILL_ALPHA = 0.15;
const COUNTRY_BORDER_STROKE = 2.5; // pixels
// UI-DESIGN-4 click fix: react-globe.gl (three-render-objects) treats ANY pointer move between
// press and release of a mouse as a drag and then drops the click; on a trackpad that happens on
// most clicks. A press that moved at most this far still counts as a click.
const CLICK_SLOP_PX = 6;
// Wait this long for the globe's own click (it fires one frame after pointerup) before stepping in.
const CLICK_FALLBACK_MS = 120;

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

/** "#rrggbb" with an alpha as rgba(), for the light continent fill. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/** "#rrggbb" a quarter of the way towards black: the stronger shade for the hovered country. */
function stronger(hex: string, alpha = 1): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c * 0.75));
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/** "#rrggbb" mixed halfway towards white, so the continent lines stand out on the light fill. */
function lighter(hex: string): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round((c + 255) / 2));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

function continentColour(feature: CountryFeature): string {
  return CONTINENT_COLOURS[feature.properties.CONTINENT] ?? FALLBACK_COLOUR;
}

/** One border line on the globe; each point is a [lng, lat] position. */
type BorderPath = { ring: Ring; colour: string; stroke: number | null };
const borderPoints = (path: object) => (path as BorderPath).ring as unknown[];
const borderColour = (path: object) => (path as BorderPath).colour;
const borderStroke = (path: object) => (path as BorderPath).stroke;
const ringLat = (point: Ring[number]) => point[1] ?? 0;
const ringLng = (point: Ring[number]) => point[0] ?? 0;

type FeatureCollection<F> = { features: F[] };

export function hasWebGL(): boolean {
  if (typeof WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Level 1 groups by continent, level 2 by country. */
function hoverKey(level: GlobeLevel, feature: CountryFeature): string {
  return level.kind === "continents"
    ? feature.properties.CONTINENT
    : feature.properties.ADM0_A3;
}

function isSelectable(level: GlobeLevel, feature: CountryFeature): boolean {
  return !(
    level.kind === "continents" &&
    NON_SELECTABLE_CONTINENTS.has(feature.properties.CONTINENT)
  );
}

function segmentLabel(
  step: GlobeLevel,
  country: CountryFeature | undefined,
): string {
  switch (step.kind) {
    case "continents":
      return t("globe.path.globe");
    case "countries":
      return step.continent;
    case "regions":
      return country?.properties.NAME ?? step.country;
    case "state":
      return step.name;
  }
}

function segmentClass(step: GlobeLevel, current: boolean): string {
  return [
    "earth-globe__breadcrumb-segment",
    current ? "earth-globe__breadcrumb-segment--current" : "",
    step.kind === "countries" ? "earth-globe__breadcrumb-continent" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchCollection<F>(url: string): Promise<F[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  const data = (await response.json()) as FeatureCollection<F>;
  return data.features;
}

function initialLevel(): GlobeLevel {
  // Development aid for screenshots, e.g. ?globe=Europe/AUT. Never active in production builds.
  return import.meta.env.DEV
    ? levelFromQuery(window.location.search)
    : INITIAL_LEVEL;
}

/** The open state view (E-43), reported to the layout for the sidebar and the state map. */
/** What the search field needs from the globe (E-52b). */
export type SearchNavigator = {
  /** Opens a state view through the regular reducer steps (openStateActions). */
  openState: (target: StateTarget) => void;
  /** Natural Earth NAME of a country, or the code itself while the countries are not loaded. */
  countryName: (iso3: string) => string;
};

export type OpenState = {
  continent: string;
  country: string;
  countryName: string;
  adm1: string;
  name: string;
  /** Natural Earth outline of the state, if the country's admin-1 file is loaded. */
  outline: PolygonGeometry | null;
  /** The country's other states, drawn faintly around it. */
  surroundings: readonly PolygonGeometry[];
};

/**
 * The open country map (level 3), reported to the layout for the side panel (UI-DESIGN-9): the
 * country, its outline and the states drawn on the map (same Natural Earth admin-1 data).
 */
export type OpenCountry = {
  continent: string;
  country: string;
  name: string;
  geometry: PolygonGeometry;
  /** The country's states; empty while loading or when the file is missing. */
  states: readonly RegionFeature[];
  /** False for countries the regions API does not serve (E-49): no state list, no state view. */
  hasRegions: boolean;
  /** Opens a state's view exactly like a click on it in the country map (UI-DESIGN-11). */
  openState: (state: RegionFeature) => void;
};

type EarthGlobeProps = {
  /** Called with the open country map, or null when none is open (UI-DESIGN-9). */
  onCountryChange?: (country: OpenCountry | null) => void;
  /** Called when the 2D country map opens or closes (the layout shows the side panel). */
  onCountryOpenChange?: (open: boolean) => void;
  /** Called with the open state view, or null when none is open (E-43). */
  onStateChange?: (state: OpenState | null) => void;
  /** Renders the state map with its data; without it the state view shows no map. */
  renderStateMap?: (state: OpenState) => ReactNode;
  /** Called when the user picks a country or state (UI-SEL); continents are not reported. */
  onPick?: (pick: MapPick) => void;
  /**
   * Called with a function that jumps to the globe view (UI-DESIGN-3; before: the continent) while
   * a country or deeper is shown, else with null; the layout collapses the search bar to an icon
   * that calls it (E-48).
   */
  onOpenContinentChange?: (openContinent: (() => void) | null) => void;
  /** Called with the search navigation, renewed once the country names are loaded (E-52b). */
  onSearchNavigatorChange?: (navigator: SearchNavigator) => void;
};

/** Globe stage. Without WebGL only the notice is shown; there is no 2D replacement. */
export function EarthGlobe(props: EarthGlobeProps) {
  const [webgl] = useState(hasWebGL);
  if (!webgl) {
    return (
      <section className="earth-globe earth-globe--unavailable">
        <p className="earth-globe__notice" role="status">
          {t("globe.webglFallback")}
        </p>
      </section>
    );
  }
  return <GlobeView {...props} />;
}

function GlobeView({
  onCountryChange,
  onCountryOpenChange,
  onStateChange,
  renderStateMap,
  onPick,
  onOpenContinentChange,
  onSearchNavigatorChange,
}: EarthGlobeProps) {
  const headingId = useId();
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  // Click fix (see CLICK_SLOP_PX): the hovered polygon, the current mouse press, and which press
  // the globe itself already turned into a click.
  const hoverFeature = useRef<CountryFeature | null>(null);
  const press = useRef<{
    x: number;
    y: number;
    feature: CountryFeature | null;
    id: number;
  } | null>(null);
  const pressCount = useRef(0);
  const lastPress = useRef(0);
  const handledPress = useRef(0);
  const clickFallback = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(clickFallback.current);
    },
    [],
  );
  const [level, dispatch] = useReducer(globeReducer, undefined, initialLevel);
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [regions, setRegions] = useState<RegionFeature[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  // UI-DESIGN-2: back on the globe view (continents) from any deeper level, by the back tile, a path
  // segment or Esc. Switching to the globe view rebuilds every country polygon of the globe in one
  // synchronous render, which blocks the browser from painting. So the loader is set in the click
  // itself, painted first, and the level switch follows two animation frames later.
  const [loader, setLoader] = useState<"off" | "on" | "fading">("off");
  const [switchPending, setSwitchPending] = useState(false);
  const loaderShownAt = useRef(0);
  const pendingFrame = useRef<number | null>(null);
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(
    () => () => {
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    },
    [],
  );

  const navigate = useCallback((action: GlobeAction) => {
    setHovered(null);
    const current = levelRef.current;
    if (
      current.kind === "continents" ||
      globeReducer(current, action).kind !== "continents"
    ) {
      dispatch(action);
      return;
    }
    loaderShownAt.current = performance.now();
    setLoader("on");
    setSwitchPending(true);
    if (pendingFrame.current !== null)
      cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null;
        setSwitchPending(false);
        dispatch(action);
      });
    });
  }, []);

  // Once the globe view is rendered (its camera move starts in the same commit), keep the loader
  // for the move plus a short tail, at least GLOBE_LOADING_MIN_MS from the click; then fade out.
  useEffect(() => {
    if (loader !== "on" || level.kind !== "continents") return;
    const elapsed = performance.now() - loaderShownAt.current;
    const timer = window.setTimeout(
      () => {
        setLoader("fading");
      },
      Math.max(
        TRANSITION_MS + GLOBE_LOADING_TAIL_MS,
        GLOBE_LOADING_MIN_MS - elapsed,
      ),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [loader, level.kind]);
  useEffect(() => {
    if (loader !== "fading") return;
    const timer = window.setTimeout(() => {
      setLoader("off");
    }, GLOBE_LOADING_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loader]);
  // Leaving the globe view again before the loader ended hides it at once.
  const showLoader =
    loader !== "off" && (switchPending || level.kind === "continents");
  // The first camera is set without animation, so the globe opens on NASA HQ instead of swinging there.
  const firstView = useRef(true);
  const removeStars = useRef<(() => void) | null>(null);
  useEffect(() => () => removeStars.current?.(), []);

  // Levels 3 (country map) and 4 (state map) cover the globe with a flat map.
  const mapOpen = level.kind === "regions" || level.kind === "state";
  const regionCountry = mapOpen ? level.country : null;
  const countryOpen = mapOpen;

  useEffect(() => {
    onCountryOpenChange?.(countryOpen);
  }, [countryOpen, onCountryOpenChange]);

  const deep = isCountryOrDeeper(level);
  // UI-DESIGN-3: the collapsed search icon now leads to the outermost globe view, the same way
  // as the back tile and the path (loader included); the layout then opens the search field.
  const openContinent = useCallback(() => {
    navigate({ type: "goTo", depth: 0 });
  }, [navigate]);
  useEffect(() => {
    onOpenContinentChange?.(deep ? openContinent : null);
  }, [deep, openContinent, onOpenContinentChange]);

  const searchNavigator = useMemo<SearchNavigator>(
    () => ({
      openState: (target) => {
        setHovered(null);
        for (const action of openStateActions(target)) dispatch(action);
      },
      countryName: (iso3) =>
        countries?.find((c) => c.properties.ADM0_A3 === iso3)?.properties
          .NAME ?? iso3,
    }),
    [countries],
  );
  useEffect(() => {
    onSearchNavigatorChange?.(searchNavigator);
  }, [searchNavigator, onSearchNavigatorChange]);

  useEffect(() => {
    let active = true;
    fetchCollection<CountryFeature>(`${GEO_BASE}countries.json`).then(
      (features) => {
        if (active) setCountries(features);
      },
      () => {
        // Without the country file the globe stays a plain Blue Marble sphere; there is no other view.
        if (active) setCountries([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // Admin-1 is loaded only when a country is clicked; the globe never draws it.
  useEffect(() => {
    if (regionCountry === null) return;
    let active = true;
    fetchCollection<RegionFeature>(
      `${GEO_BASE}admin1/${encodeURIComponent(regionCountry)}.json`,
    ).then(
      (features) => {
        if (active) setRegions(features);
      },
      () => {
        if (active) setRegions([]);
      },
    );
    return () => {
      active = false;
    };
  }, [regionCountry]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    // The page fills the viewport; follow its size (ResizeObserver is missing in jsdom).
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("resize", update);
      };
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Esc goes up one level, like the Back button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest("input, select, textarea")
      ) {
        return;
      }
      navigate({ type: "back" });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate]);

  // Fixed camera per level. While the 2D map covers the globe, its render loop is paused.
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe || countries === null) return;
    if (mapOpen) {
      globe.pauseAnimation();
      return;
    }
    globe.resumeAnimation();
    const duration = firstView.current ? 0 : TRANSITION_MS;
    firstView.current = false;
    globe.pointOfView(cameraForLevel(level, countries), duration);
  }, [ready, level, countries, mapOpen]);

  // Stable inputs for react-globe.gl: new arrays or accessors make it re-digest every polygon.
  const continent = level.kind === "continents" ? null : level.continent;
  const polygons = useMemo(
    () => (countries === null ? [] : globePolygons(continent, countries)),
    [countries, continent],
  );

  const capColour = useCallback(
    (obj: object) => {
      const feature = obj as CountryFeature;
      const own = continentColour(feature);
      if (level.kind === "continents") {
        return hoverKey(level, feature) === hovered
          ? withAlpha(own, CONTINENT_HOVER_ALPHA)
          : withAlpha(own, CONTINENT_FILL_ALPHA);
      }
      if (hoverKey(level, feature) === hovered)
        return stronger(own, HOVER_FILL_ALPHA);
      return withAlpha(own, COUNTRY_FILL_ALPHA);
    },
    [level, hovered],
  );
  // Outlines in the continent colour, thick on level 2; they never depend on hover (E-61).
  const borders = useMemo<BorderPath[]>(
    () =>
      polygons.flatMap((feature) =>
        borderRings([feature]).map((ring) => ({
          ring,
          colour: lighter(continentColour(feature)),
          stroke: continent === null ? null : COUNTRY_BORDER_STROKE,
        })),
      ),
    [continent, polygons],
  );
  const label = useCallback(
    (obj: object) => {
      const feature = obj as CountryFeature;
      return escapeHtml(
        level.kind === "continents"
          ? feature.properties.CONTINENT
          : feature.properties.NAME,
      );
    },
    [level.kind],
  );

  const country = mapOpen
    ? countries?.find((c) => c.properties.ADM0_A3 === level.country)
    : undefined;
  const mapRegions = useMemo(
    () =>
      regionCountry === null ? [] : regionsForCountry(regionCountry, regions),
    [regionCountry, regions],
  );

  const openState = useMemo<OpenState | null>(() => {
    if (level.kind !== "state") return null;
    const own = mapRegions.filter(
      (region) => region.properties.iso_3166_2 === level.adm1,
    );
    return {
      continent: level.continent,
      country: level.country,
      countryName: country?.properties.NAME ?? level.country,
      adm1: level.adm1,
      name: level.name,
      outline: own[0]?.geometry ?? null,
      surroundings: mapRegions
        .filter((region) => region.properties.iso_3166_2 !== level.adm1)
        .map((region) => region.geometry),
    };
  }, [level, country, mapRegions]);

  useEffect(() => {
    onStateChange?.(openState);
  }, [openState, onStateChange]);

  // A state chosen on the country map or in its side panel list opens the state view (E-43).
  const openRegion = useCallback(
    (region: RegionFeature) => {
      dispatch({
        type: "selectState",
        adm1: region.properties.iso_3166_2,
        name: region.properties.name,
      });
      onPick?.({
        kind: "state",
        iso: region.properties.iso_3166_2,
        name: region.properties.name,
        geometry: region.geometry,
      });
    },
    [onPick],
  );

  const openCountry = useMemo<OpenCountry | null>(() => {
    if (level.kind !== "regions" || country === undefined) return null;
    return {
      continent: level.continent,
      country: level.country,
      name: country.properties.NAME,
      geometry: country.geometry,
      states: mapRegions,
      hasRegions: hasRegionView(level.country),
      openState: (region) => {
        openRegion(region);
      },
    };
  }, [level, country, mapRegions, openRegion]);

  useEffect(() => {
    onCountryChange?.(openCountry);
  }, [openCountry, onCountryChange]);

  const pathSlot = useContext(PathSlotContext);
  // E-55: a tall tile on the map's left edge goes back exactly one level; hidden on the globe.
  const backTile =
    level.kind !== "continents" ? (
      <button
        type="button"
        className="earth-globe__back-tile"
        data-closes-sheet=""
        data-testid="globe-back"
        aria-label={`${t(
          level.kind === "regions" ? "globe.backToGlobe" : "globe.back",
        )}: ${[
          level.continent,
          country?.properties.NAME,
          level.kind === "state" ? level.name : undefined,
        ]
          .filter(Boolean)
          .join(" / ")}`}
        onClick={() => {
          navigate({ type: "back" });
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M15 4L7 12L15 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    ) : null;
  // E-52d: inside AppLayout the chip goes into the toolbar row, next to the search icon.
  const breadcrumb =
    level.kind !== "continents" ? (
      <div className="earth-globe__breadcrumb" data-testid="globe-path">
        {levelPath(level).map((step, depth, path) => {
          const label = segmentLabel(step, country);
          const current = depth === path.length - 1;
          return (
            <span key={step.kind} className="earth-globe__breadcrumb-step">
              {depth > 0 && (
                <span
                  className="earth-globe__breadcrumb-separator"
                  aria-hidden="true"
                >
                  {" / "}
                </span>
              )}
              {current ? (
                <span
                  className={segmentClass(step, true)}
                  aria-current="location"
                >
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  className={segmentClass(step, false)}
                  onClick={() => {
                    navigate({ type: "goTo", depth });
                  }}
                >
                  {label}
                </button>
              )}
            </span>
          );
        })}
      </div>
    ) : null;

  /** A click on a globe polygon: level 1 opens the continent, level 2 the country. */
  const selectFeature = (feature: CountryFeature) => {
    if (mapOpen || !isSelectable(level, feature)) {
      return;
    }
    setHovered(null);
    if (level.kind === "continents") {
      dispatch({
        type: "selectContinent",
        continent: feature.properties.CONTINENT,
      });
    } else {
      dispatch({
        type: "selectCountry",
        country: feature.properties.ADM0_A3,
      });
      onPick?.({
        kind: "country",
        name: feature.properties.NAME,
        geometry: feature.geometry,
      });
    }
  };
  const selectRef = useRef(selectFeature);
  useEffect(() => {
    selectRef.current = selectFeature;
  });

  return (
    <section className="earth-globe" aria-labelledby={headingId}>
      <div
        ref={containerRef}
        className="earth-globe__canvas"
        role="img"
        aria-label={t("globe.ariaLabel")}
        aria-hidden={mapOpen}
        data-level={level.kind}
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || event.pointerType !== "mouse") return;
          pressCount.current += 1;
          press.current = {
            x: event.clientX,
            y: event.clientY,
            feature: hoverFeature.current,
            id: pressCount.current,
          };
        }}
        onPointerUpCapture={(event) => {
          const pressed = press.current;
          press.current = null;
          if (pressed === null || event.button !== 0) return;
          lastPress.current = pressed.id;
          const moved = Math.hypot(
            event.clientX - pressed.x,
            event.clientY - pressed.y,
          );
          // A real drag rotates the globe and is no click.
          if (moved > CLICK_SLOP_PX || pressed.feature === null) return;
          const feature = pressed.feature;
          window.clearTimeout(clickFallback.current);
          clickFallback.current = window.setTimeout(() => {
            // The globe registered this click itself: nothing to do.
            if (handledPress.current === pressed.id) return;
            selectRef.current(feature);
          }, CLICK_FALLBACK_MS);
        }}
      >
        {size.width > 0 && size.height > 0 && (
          <Suspense fallback={null}>
            <Globe
              ref={globeRef}
              width={size.width}
              height={size.height}
              backgroundColor="#0b1a24"
              globeImageUrl={TEXTURE_URL}
              showAtmosphere
              onGlobeReady={() => {
                // No free zoom: wheel, pinch and double-click zoom are off; rotating by drag stays.
                // OrbitControls is typed by @types/three, which is not a dependency; only this flag is used.
                const globe = globeRef.current;
                if (globe) {
                  (globe.controls() as { enableZoom: boolean }).enableZoom =
                    false;
                  // E-62: starfield; loaded with three.js only once the globe exists.
                  const reducedMotion = window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches;
                  void import("./starfield").then(({ addStarfield }) => {
                    removeStars.current?.();
                    removeStars.current = addStarfield(
                      globe.scene(),
                      reducedMotion,
                    );
                  });
                }
                setReady(true);
              }}
              polygonsData={polygons}
              polygonGeoJsonGeometry="geometry"
              polygonCapColor={capColour}
              polygonSideColor={SIDE_COLOUR}
              polygonStrokeColor={NO_STROKE}
              // Fixed altitude: hover only changes the colour, so no geometry is rebuilt.
              polygonAltitude={POLYGON_ALTITUDE}
              polygonsTransitionDuration={0}
              pathsData={borders}
              pathPoints={borderPoints}
              pathPointLat={ringLat}
              pathPointLng={ringLng}
              pathPointAlt={BORDER_ALTITUDE}
              pathColor={borderColour}
              pathStroke={borderStroke}
              pathTransitionDuration={0}
              polygonLabel={label}
              onPolygonHover={(obj) => {
                const feature = obj as CountryFeature | null;
                // While the globe thinks the mouse drags it reports no hover; keep the last one.
                if (feature !== null || press.current === null) {
                  hoverFeature.current = feature;
                }
                setHovered(
                  feature && isSelectable(level, feature)
                    ? hoverKey(level, feature)
                    : null,
                );
              }}
              onPolygonClick={(obj) => {
                handledPress.current = lastPress.current;
                selectFeature(obj as CountryFeature);
              }}
            />
          </Suspense>
        )}
      </div>
      {level.kind === "regions" && country !== undefined && (
        <div className="earth-globe__map">
          <CountryMap
            country={country}
            regions={mapRegions}
            previousCountry={level.previous}
            countries={countries ?? []}
            onSelectNeighbour={(neighbour) => {
              dispatch({
                type: "switchCountry",
                continent: neighbour.properties.CONTINENT,
                country: neighbour.properties.ADM0_A3,
              });
              onPick?.({
                kind: "country",
                name: neighbour.properties.NAME,
                geometry: neighbour.geometry,
              });
            }}
            onSelectRegion={
              hasRegionView(level.country) ? openRegion : undefined
            }
          />
        </div>
      )}
      {/* E-49: countries the regions API does not serve get a quiet notice below the path. */}
      {level.kind === "regions" &&
        country !== undefined &&
        !hasRegionView(level.country) && (
          <p
            className="earth-globe__unsupported"
            data-testid="region-unsupported"
          >
            {t("region.unsupported")}
          </p>
        )}
      {/* E-49b: a continent where no country has a region view gets its own notice. */}
      {level.kind === "countries" &&
        countries !== null &&
        !continentHasRegionView(level.continent, countries) && (
          <p
            className="earth-globe__unsupported"
            data-testid="region-unsupported-continent"
          >
            {t("region.unsupportedContinent")}
          </p>
        )}
      {openState !== null && renderStateMap !== undefined && (
        <div className="earth-globe__map">{renderStateMap(openState)}</div>
      )}
      {showLoader && (
        <div
          className="earth-globe__loading"
          role="status"
          aria-live="polite"
          data-testid="globe-loading"
          data-phase={loader}
        >
          <span className="earth-globe__spinner" aria-hidden="true" />
          <p className="earth-globe__loading-text">{t("globe.loading")}</p>
        </div>
      )}
      {/* Level title for assistive tech only; the floor plan shows just the path. */}
      <h2 id={headingId} className="visually-hidden">
        {t(
          (level.kind === "regions" || level.kind === "state") &&
            level.country === US
            ? "region.level.usStates"
            : LEVEL_TITLES[level.kind],
        )}
      </h2>
      {backTile}
      {/* Path "Globe / EUROPE / Austria" (E-35): each earlier segment jumps to its level, the
          current one is plain text; back one level is the tile on the left (E-55). */}
      {breadcrumb !== null &&
        (pathSlot !== null ? createPortal(breadcrumb, pathSlot) : breadcrumb)}
    </section>
  );
}
