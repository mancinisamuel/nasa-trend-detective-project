import { useEffect, useState, type ReactNode } from "react";

import { HowToModal } from "../../features/howto/HowToModal";
import { t } from "../../i18n";
import { PathSlotContext } from "./pathSlot";
import { SearchbarPlaceholder } from "./SearchbarPlaceholder";
import { SidePanelPlaceholder } from "./SidePanelPlaceholder";

type AppLayoutProps = {
  /** True while a state view or results are open: the floating side panel appears (UI-DESIGN-5). */
  panelOpen: boolean;
  /** Visually hidden page heading. */
  heading: ReactNode;
  /** The globe or 2D country map. */
  children: ReactNode;
  /** Replaces the side panel placeholder while given (state sidebar, E-43). */
  panelContent?: ReactNode;
  /**
   * While set (a country or deeper is shown, E-48) the search bar is collapsed to its icon, and
   * the icon calls this to go back to the globe view and focus the search (UI-DESIGN-3).
   */
  onSearchIconClick?: (() => void) | null;
  /** The search field in the open search bar (E-52b). */
  search?: ReactNode;
  /** Timeline at the bottom of the globe card (UI-LAYOUT). */
  timeline?: ReactNode;
  /**
   * UI-DESIGN-12: false on the globe and continent views, so the stage keeps the whole card; from
   * the country level on the timeline fades in (its period lives in the selection, not here).
   */
  timelineVisible?: boolean;
  /**
   * UI-DESIGN-14: true from the country level down. Its switch from false to true (globe or
   * continent -> country) plays the entry animation once; country <-> state keeps it true.
   */
  countryLevel?: boolean;
  /** Results in the same card under the timeline; kept mounted once provided, hidden while closed. */
  results?: ReactNode;
  resultsOpen: boolean;
  onExpandGlobe: () => void;
};

/** Longer than the slowest entry step (dock: 180 ms delay + 320 ms), in case no animationend fires. */
const ENTER_FALLBACK_MS = 1000;

/** Chevron down: folds the bottom card away, so the globe takes the card again. */
function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 10l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Page frame (UI-LAYOUT): one card holds the globe stage, optional side panel, the timeline and
 * the results. CALCULATE collapses the globe and shows results in the same card; the chevron
 * above the timeline expands the globe again and hides the results without unmounting them.
 */
export function AppLayout({
  panelOpen,
  heading,
  children,
  panelContent,
  onSearchIconClick = null,
  search,
  timeline,
  timelineVisible = true,
  countryLevel = false,
  results,
  resultsOpen,
  onExpandGlobe,
}: AppLayoutProps) {
  const [pathSlot, setPathSlot] = useState<HTMLDivElement | null>(null);
  const timelineShown = timeline !== undefined && timelineVisible;
  // Entry animation (UI-DESIGN-14): marked while entering the country level, cleared when the dock
  // (the last element) has arrived, at the latest after ENTER_FALLBACK_MS.
  const [entering, setEntering] = useState(false);
  const [previousLevel, setPreviousLevel] = useState(countryLevel);
  if (previousLevel !== countryLevel) {
    setPreviousLevel(countryLevel);
    setEntering(countryLevel);
  }
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => {
      setEntering(false);
    }, ENTER_FALLBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [entering]);
  return (
    <main
      className="app-layout"
      data-panel={panelOpen ? "open" : "closed"}
      data-results={resultsOpen ? "open" : "closed"}
      data-enter={entering ? "country" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "dock-enter") setEntering(false);
      }}
      data-testid="app-layout"
    >
      {heading}
      <div className="app-layout__main" data-testid="main-area">
        <div className="app-layout__card">
          {/* E-52e: a click on the search field, the search icon, a path segment or the back tile
              (E-55, marked data-closes-sheet) expands the globe again and hides the results.
              The path chip is portalled into the toolbar, so the check goes by DOM position,
              and React still routes its clicks through this stage. */}
          <div
            className="app-layout__stage"
            onClickCapture={(event) => {
              if (
                resultsOpen &&
                event.target instanceof Element &&
                event.target.closest(
                  ".app-layout__toolbar :is(button, input), [data-closes-sheet]",
                ) !== null
              ) {
                onExpandGlobe();
              }
            }}
          >
            <PathSlotContext.Provider value={pathSlot}>
              {children}
            </PathSlotContext.Provider>
            {/* E-52d: one row top left, the path chip first and the collapsed search icon right of
                it; the open search bar is centred over the row. */}
            <div className="app-layout__toolbar">
              <div className="app-layout__path-slot" ref={setPathSlot} />
              <SearchbarPlaceholder
                collapsed={resultsOpen || onSearchIconClick !== null}
                onIconClick={onSearchIconClick ?? undefined}
              >
                {search}
              </SearchbarPlaceholder>
              <HowToModal />
            </div>
          </div>
          {panelOpen && (panelContent ?? <SidePanelPlaceholder />)}
          {/* UI-DESIGN-12: timeline and results share one floating dock (same look as the side
              panel); a fine divider separates them once the results are open. */}
          {(timelineShown || results !== undefined) && (
            <div
              className="app-layout__dock"
              data-testid="timeline-dock"
              hidden={!timelineShown && !resultsOpen}
            >
              {/* UI-DESIGN-13: a small round button docked above the card's top right corner,
                  only while the results are open; the card itself has no chevron strip any more. */}
              {resultsOpen && (
                <button
                  type="button"
                  className="app-layout__expand"
                  aria-label={t("layout.expandGlobe")}
                  onClick={onExpandGlobe}
                >
                  <ExpandIcon />
                </button>
              )}
              {timelineShown && (
                <div className="app-layout__timeline">{timeline}</div>
              )}
              {results !== undefined && (
                <div
                  className="app-layout__results"
                  data-testid="results"
                  hidden={!resultsOpen}
                >
                  <div
                    role="region"
                    className="app-layout__graphs"
                    aria-label={t("layout.graphPlaceholder")}
                    data-testid="graph-placeholder"
                  >
                    {results}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
