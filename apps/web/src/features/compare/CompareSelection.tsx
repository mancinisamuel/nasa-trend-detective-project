import { createContext, useContext, useState, type ReactNode } from "react";

import type { MapPick } from "../../components/globeLevels";
import {
  clampYearRange,
  defaultYearRange,
  type YearRange,
} from "./compareRequest";
import type { MetricId } from "../extremes/metrics";
import type { CatalogResponse } from "./contract";
import { placeFromPick, samePlace, type Place } from "./mapSelection";
import { StaleNoticeProvider } from "./staleNotice";
import { useCatalog } from "./useCompare";

/** Default location (Potter's decision): Vienna, if the catalog has it. */
const DEFAULT_LOCATION_ID = "vienna";

/** Which series the results chart and sidebar metrics show. */
export type ChartView =
  { kind: "variable" } | { kind: "extreme"; id: MetricId };

/** Variable, location and period of one analysis. */
export type Selection = {
  variableId: string;
  place: Place;
  range: YearRange;
};

type CompareSelectionValue = {
  catalog: ReturnType<typeof useCatalog>;
  /** Current controls (variable and location in the sheet, period on the main-screen timeline). */
  draft: Selection | null;
  /** Selection of the last analysis; only the arrow button changes it. */
  applied: Selection | null;
  /** Series shown in the results chart and the sidebar metrics. */
  chartView: ChartView;
  setVariable: (variableId: string) => void;
  setChartView: (view: ChartView) => void;
  /** Catalog location from the dropdown. */
  setLocation: (locationId: string) => void;
  /** Element picked on globe, map or sidebar (UI-SEL); sends nothing until CALCULATE. */
  pickOnMap: (pick: MapPick) => void;
  setRange: (range: YearRange) => void;
  apply: () => void;
  /**
   * UI-DESIGN-8: picks an element and applies it in one step (same request as CALCULATE, period
   * from the timeline), e.g. "Calculate for <state>" while a county was selected before.
   */
  applyPick: (pick: MapPick) => void;
};

const CompareSelectionContext = createContext<CompareSelectionValue | null>(
  null,
);

function defaultSelection(catalog: CatalogResponse): Selection {
  const locationId =
    catalog.locations.find((l) => l.id === DEFAULT_LOCATION_ID)?.id ??
    catalog.locations[0]?.id ??
    "";
  // First enabled variable in catalog order.
  const variableId = catalog.variables.find((v) => v.enabled)?.id ?? "";
  return {
    variableId,
    place: { kind: "catalog", id: locationId },
    range: defaultYearRange(catalog, variableId),
  };
}

/**
 * Shares the selection between the timeline on the main screen and the bottom sheet.
 * Until the user changes something, both draft and applied follow the catalog defaults
 * (full catalog period, Vienna).
 */
export function CompareSelectionProvider({
  onApply,
  children,
}: {
  /** Called after the arrow button applied the selection, e.g. to open the sheet. */
  onApply?: () => void;
  children: ReactNode;
}) {
  const catalog = useCatalog();
  const [draftState, setDraftState] = useState<Selection | null>(null);
  const [appliedState, setAppliedState] = useState<Selection | null>(null);
  const [chartView, setChartView] = useState<ChartView>({ kind: "variable" });
  const fallback = catalog.data ? defaultSelection(catalog.data) : null;
  const draft = draftState ?? fallback;
  const applied = appliedState ?? fallback;

  const value: CompareSelectionValue = {
    catalog,
    draft,
    applied,
    chartView,
    setChartView,
    setVariable: (variableId) => {
      if (!draft) return;
      const range = catalog.data
        ? clampYearRange(catalog.data, draft.range, "end", variableId)
        : draft.range;
      setDraftState({ ...draft, variableId, range });
    },
    setLocation: (locationId) => {
      if (draft) {
        setDraftState({ ...draft, place: { kind: "catalog", id: locationId } });
      }
    },
    pickOnMap: (pick) => {
      const place = catalog.data ? placeFromPick(catalog.data, pick) : null;
      if (draft && place) setDraftState({ ...draft, place });
    },
    setRange: (range) => {
      if (draft) setDraftState({ ...draft, range });
    },
    apply: () => {
      if (draft) setAppliedState(draft);
      onApply?.();
    },
    applyPick: (pick) => {
      const place = catalog.data ? placeFromPick(catalog.data, pick) : null;
      if (!draft || !place) return;
      const next = { ...draft, place };
      setDraftState(next);
      setAppliedState(next);
      onApply?.();
    },
  };
  return (
    <CompareSelectionContext.Provider value={value}>
      <StaleNoticeProvider>{children}</StaleNoticeProvider>
    </CompareSelectionContext.Provider>
  );
}

export function useCompareSelection(): CompareSelectionValue {
  const value = useContext(CompareSelectionContext);
  if (value === null) {
    throw new Error("useCompareSelection needs a CompareSelectionProvider");
  }
  return value;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.variableId === b.variableId &&
    samePlace(a.place, b.place) &&
    a.range.start === b.range.start &&
    a.range.end === b.range.end
  );
}

export function samePlaceAndRange(a: Selection, b: Selection): boolean {
  return (
    samePlace(a.place, b.place) &&
    a.range.start === b.range.start &&
    a.range.end === b.range.end
  );
}
