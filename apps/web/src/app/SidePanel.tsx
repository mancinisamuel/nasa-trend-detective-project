import { useState, type ReactNode } from "react";

import type { MapPick } from "../components/globeLevels";
import { CityResultCard } from "../features/compare/CityResultCard";
import { CompareMetrics } from "../features/compare/CompareMetrics";
import { useCompareSelection } from "../features/compare/CompareSelection";
import { placeFromPick, samePlace } from "../features/compare/mapSelection";
import { tf } from "../i18n";

/**
 * Content of the floating side panel (UI-DESIGN-5 to 8). One surface, three states:
 * A) a country or state is open, nothing selected: its list (states, or municipalities/districts)
 *    and "Calculate for <country/state>"; countries without regions show no list (UI-DESIGN-9);
 * B) an entry is selected, not yet calculated: the list stays (entry marked) and the entry's card
 *    with an X (removes the selection, back to A) and "Calculate for <entry>" sits below it;
 * C) the entry or the state is calculated: the list is hidden (kept mounted), the place stands at
 *    the top with "Change location" (back to A), then the trend figures once and the record tiles.
 * Outside a country or state view the metrics show as before.
 */
export function SidePanel({
  renderRegion,
  parentPick,
  cityName,
  onChangeLocation,
  resultsReady,
}: {
  /** Region list of the open state (hidden while a calculated place is shown), or null. */
  renderRegion: ((hidden: boolean) => ReactNode) | null;
  /**
   * The open country or state as a map pick, or null. The contract has no region target, so it is
   * sent like a pick on the map: its catalog entry if there is one (e.g. "austria", averaged by the
   * backend), otherwise a point at the centre of its outline (placeFromPick).
   */
  parentPick: Extract<MapPick, { kind: "state" | "country" }> | null;
  /** Label of the selected entry of the open state, or null. */
  cityName: string | null;
  /** Removes the selected entry (X in B, Change location in C). */
  onChangeLocation: () => void;
  resultsReady: boolean;
}) {
  const { catalog, draft, applied, applyPick } = useCompareSelection();
  // The state's result is shown after "Calculate for <state>" until Change location or a new pick.
  const [stateResult, setStateResult] = useState(false);
  const [previousCity, setPreviousCity] = useState(cityName);
  if (previousCity !== cityName) {
    setPreviousCity(cityName);
    if (cityName !== null) setStateResult(false);
  }
  const statePlace =
    parentPick !== null && catalog.data !== undefined
      ? placeFromPick(catalog.data, parentPick)
      : null;
  const cityCalculated =
    cityName !== null &&
    draft !== null &&
    applied !== null &&
    samePlace(draft.place, applied.place);
  const stateCalculated =
    stateResult &&
    parentPick !== null &&
    cityName === null &&
    statePlace !== null &&
    applied !== null &&
    samePlace(applied.place, statePlace);
  const calculated = cityCalculated || stateCalculated;
  // In a state view results belong to a calculated place only (state C); in A and B older
  // results stay out of the panel.
  const showMetrics = resultsReady && (parentPick === null || calculated);
  return (
    <div
      className="app-layout__side app-layout__side--fill"
      data-testid="side-panel"
      data-state={
        parentPick === null
          ? undefined
          : calculated
            ? "calculated"
            : cityName !== null
              ? "selected"
              : "state"
      }
    >
      {cityCalculated && (
        <CityResultCard name={cityName} onChangeLocation={onChangeLocation} />
      )}
      {stateCalculated && (
        <CityResultCard
          name={parentPick.name}
          onChangeLocation={() => {
            setStateResult(false);
          }}
        />
      )}
      {renderRegion?.(calculated)}
      {cityName !== null && !cityCalculated && (
        <CityResultCard
          name={cityName}
          onChangeLocation={onChangeLocation}
          onClear={onChangeLocation}
        />
      )}
      {parentPick !== null && cityName === null && !stateCalculated && (
        <div className="side-panel__state-calculate">
          <button
            type="button"
            className="result-card__calculate"
            disabled={statePlace === null}
            onClick={() => {
              applyPick(parentPick);
              setStateResult(true);
            }}
          >
            {tf("result.calculateFor", { name: parentPick.name })}
          </button>
        </div>
      )}
      {showMetrics && <CompareMetrics hideVariableTrend={calculated} />}
    </div>
  );
}
