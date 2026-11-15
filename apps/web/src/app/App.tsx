import { useCallback, useRef, useState } from "react";

import {
  EarthGlobe,
  type OpenCountry,
  type OpenState,
  type SearchNavigator,
} from "../components/EarthGlobe";
import type { MapPick } from "../components/globeLevels";
import { AppLayout } from "../components/layout/AppLayout";
import {
  CompareSelectionProvider,
  useCompareSelection,
} from "../features/compare/CompareSelection";
import { CompareSheet } from "../features/compare/CompareSheet";
import { CompareTimeline } from "../features/compare/CompareTimeline";
import type { RegionSearchHit } from "../features/region/contract";
import { CountrySidebar } from "../features/region/CountrySidebar";
import {
  RegionSidebar,
  type RegionTab,
} from "../features/region/RegionSidebar";
import { StateMapView } from "../features/region/StateMapView";
import { RegionSearch } from "../features/search/RegionSearch";
import { t } from "../i18n";
import { SidePanel } from "./SidePanel";

// Floor plan: globe stage with search bar, side panel from the country map down (UI-DESIGN-9;
// before: only in a state view, E-44).
// The timeline sits at the bottom of the globe card, from the country level on (UI-DESIGN-12). CALCULATE analyses the chosen location
// and period and opens the results under a collapsed globe (UI-LAYOUT). The chevron expands
// the globe again; results stay mounted and hidden until the next CALCULATE.
// In a state view (E-43) the side panel lists the state's municipalities and districts; a click in
// the list highlights the entry on the state map.
// UI-SEL: a country, state, municipality or county picked on globe, map or sidebar becomes the
// selected location; only CALCULATE sends the request.
// E-67/E-71, UI-DESIGN-7: a selected municipality, district or county shows its card with
// "Calculate for <place>" below the list; once calculated the card replaces the list (kept mounted,
// hidden) and "Change location" brings the list back. UI-ONECHART: CompareMetrics (selected series
// + record tiles) shows in the panel with the calculated entry or outside a state view.
export function App() {
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsReady, setResultsReady] = useState(false);
  return (
    <CompareSelectionProvider
      onApply={() => {
        setResultsReady(true);
        setResultsOpen(true);
      }}
    >
      <AppShell
        resultsOpen={resultsOpen}
        resultsReady={resultsReady}
        onExpandGlobe={() => {
          setResultsOpen(false);
        }}
      />
    </CompareSelectionProvider>
  );
}

function AppShell({
  resultsOpen,
  resultsReady,
  onExpandGlobe,
}: {
  resultsOpen: boolean;
  resultsReady: boolean;
  onExpandGlobe: () => void;
}) {
  const { draft, pickOnMap } = useCompareSelection();
  const [openState, setOpenState] = useState<OpenState | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // UI-DESIGN-9: the open country map; its side panel lists the states (UI-DESIGN-11: a click
  // opens the state right away, like a click on the map).
  const [openCountry, setOpenCountry] = useState<OpenCountry | null>(null);
  // E-48: from the country level down the search bar is an icon that leads back to the continent.
  const [openContinent, setOpenContinent] = useState<(() => void) | null>(null);
  const onOpenContinentChange = useCallback((next: (() => void) | null) => {
    setOpenContinent(() => next);
  }, []);
  // UI-DESIGN-3: after the search icon took the globe back out, the search field gets the focus
  // once it is mounted again (the level switch follows the loader a few frames later).
  const [focusSearch, setFocusSearch] = useState(false);
  const onSearchFocused = useCallback(() => {
    setFocusSearch(false);
  }, []);
  const onSearchIconClick =
    openContinent === null
      ? null
      : () => {
          setFocusSearch(true);
          openContinent();
        };
  // E-52b: a search hit opens its state; its entry is highlighted by id once the state is open.
  const [searchNavigator, setSearchNavigator] =
    useState<SearchNavigator | null>(null);
  const [searchTab, setSearchTab] = useState<RegionTab | undefined>();
  const searchFocus = useRef<{ adm1: string; id: string | null } | null>(null);
  // The globe reports the open state again whenever its outline or surroundings change; only a
  // different state (adm1) clears the selection, so a search hit's highlight survives re-reports.
  const shownAdm1 = useRef<string | null>(null);
  const onStateChange = useCallback((state: OpenState | null) => {
    setOpenState(state);
    const adm1 = state?.adm1 ?? null;
    const stateChanged = adm1 !== shownAdm1.current;
    shownAdm1.current = adm1;
    const focus = searchFocus.current;
    if (focus !== null && state?.adm1 === focus.adm1) {
      setHighlightedId(focus.id);
      // The state reports again once its outline is loaded; after that the user's clicks count.
      if (state.outline !== null) searchFocus.current = null;
      return;
    }
    if (!stateChanged) return;
    searchFocus.current = null;
    setSearchTab(undefined);
    setHighlightedId(null);
  }, []);
  const onPick = useCallback(
    (pick: MapPick) => {
      if (pick.kind === "area") setHighlightedId(pick.id);
      pickOnMap(pick);
    },
    [pickOnMap],
  );
  const openSearchHit = useCallback(
    (hit: RegionSearchHit) => {
      if (searchNavigator === null) return;
      const isState = hit.type === "state";
      searchFocus.current = { adm1: hit.adm1_id, id: isState ? null : hit.id };
      setSearchTab(
        hit.type === "municipality" ? "municipalities" : "districts",
      );
      searchNavigator.openState({
        continent: hit.continent,
        country: hit.country_iso3,
        adm1: hit.adm1_id,
        name: hit.adm1_name,
      });
      pickOnMap(
        isState
          ? { kind: "state", iso: hit.id, name: hit.name, geometry: null }
          : {
              kind: "area",
              id: hit.id,
              name: hit.name,
              centroid: hit.centroid,
            },
      );
    },
    [searchNavigator, pickOnMap],
  );
  // An entry of the open state is selected; its name is the label of the picked point.
  const countryLevel = openState === null ? openCountry : null;
  const cityName =
    openState !== null &&
    highlightedId !== null &&
    draft?.place.kind === "point"
      ? draft.place.label
      : null;
  const renderStateMap = useCallback(
    (state: OpenState) => (
      <StateMapView
        country={state.country}
        adm1={state.adm1}
        name={state.name}
        outline={state.outline}
        surroundings={state.surroundings}
        highlightedId={highlightedId}
        onPick={onPick}
      />
    ),
    [highlightedId, onPick],
  );
  return (
    <AppLayout
      panelOpen={
        openState !== null ||
        openCountry !== null ||
        (resultsReady && resultsOpen)
      }
      panelContent={
        <SidePanel
          key={openState?.adm1 ?? countryLevel?.country ?? "none"}
          parentPick={
            openState !== null
              ? {
                  kind: "state",
                  iso: openState.adm1,
                  name: openState.name,
                  geometry: openState.outline,
                }
              : countryLevel !== null
                ? {
                    kind: "country",
                    name: countryLevel.name,
                    geometry: countryLevel.geometry,
                  }
                : null
          }
          renderRegion={
            countryLevel !== null
              ? countryLevel.hasRegions
                ? (hidden) => (
                    <CountrySidebar
                      hidden={hidden}
                      continent={countryLevel.continent}
                      country={countryLevel.country}
                      name={countryLevel.name}
                      states={countryLevel.states}
                      onOpen={countryLevel.openState}
                    />
                  )
                : null
              : openState === null
                ? null
                : (hidden) => (
                    <RegionSidebar
                      hidden={hidden}
                      key={openState.adm1}
                      continent={openState.continent}
                      countryName={openState.countryName}
                      country={openState.country}
                      adm1={openState.adm1}
                      name={openState.name}
                      highlightedId={highlightedId}
                      onHighlight={setHighlightedId}
                      onPick={onPick}
                      initialTab={searchTab}
                    />
                  )
          }
          cityName={cityName}
          onChangeLocation={() => {
            setHighlightedId(null);
          }}
          resultsReady={resultsReady}
        />
      }
      heading={<h1 className="visually-hidden">{t("app.title")}</h1>}
      timeline={<CompareTimeline />}
      countryLevel={openState !== null || openCountry !== null}
      timelineVisible={
        openState !== null || openCountry !== null || resultsOpen
      }
      results={resultsReady ? <CompareSheet /> : undefined}
      resultsOpen={resultsOpen}
      onExpandGlobe={onExpandGlobe}
      onSearchIconClick={onSearchIconClick}
      search={
        searchNavigator !== null && (
          <RegionSearch
            countryName={searchNavigator.countryName}
            onSelect={openSearchHit}
            autoFocus={focusSearch}
            onAutoFocused={onSearchFocused}
          />
        )
      }
    >
      <EarthGlobe
        onCountryChange={setOpenCountry}
        onStateChange={onStateChange}
        renderStateMap={renderStateMap}
        onPick={onPick}
        onOpenContinentChange={onOpenContinentChange}
        onSearchNavigatorChange={setSearchNavigator}
      />
    </AppLayout>
  );
}
