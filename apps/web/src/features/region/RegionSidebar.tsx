import { useId, useMemo, useState } from "react";

import { Button } from "../../components/ui/Button";
import { PinIcon } from "../../components/ui/PinIcon";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { t } from "../../i18n";
import { US, type MapPick } from "../../components/globeLevels";
import { ApiRequestError, apiUserMessage } from "../../lib/apiClient";
import { useRegion } from "./useRegion";

export type RegionTab = "municipalities" | "districts";
type Tab = RegionTab;
type Order = "az" | "za";

const TAB_LABEL = {
  municipalities: "region.tab.municipalities",
  districts: "region.tab.districts",
} as const;
const SEARCH_LABEL = {
  municipalities: "region.search.municipalities",
  districts: "region.search.districts",
} as const;
// USA (E-47): districts are counties and there are no municipalities, so that tab is left out.
const US_TAB_LABEL = {
  ...TAB_LABEL,
  districts: "region.tab.counties",
} as const;
const US_SEARCH_LABEL = {
  ...SEARCH_LABEL,
  districts: "region.search.counties",
} as const;
const ORDER_LABEL = { az: "region.sort.az", za: "region.sort.za" } as const;

// German collation, so umlauts and "St." sort the way Austrian names are expected to.
const collator = new Intl.Collator("de", { sensitivity: "base" });

type RegionSidebarProps = {
  continent: string;
  countryName: string;
  country: string;
  adm1: string;
  name: string;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  /** A district, municipality or county chosen in the list, with its centroid (UI-SEL). */
  onPick?: (pick: MapPick) => void;
  /** Tab shown first, e.g. the tab of a search hit (E-52b); municipalities by default. */
  initialTab?: RegionTab | undefined;
  /** Hidden while a result card replaces the list (E-67); tab, search and scroll are kept. */
  hidden?: boolean;
};

/** Scrolls the highlighted entry into the list's view (jsdom has no scrollIntoView). */
function revealEntry(element: HTMLButtonElement | null) {
  if (element !== null && "scrollIntoView" in element) {
    element.scrollIntoView({ block: "nearest" });
  }
}

export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M15.5 15.5L21 21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SortIcon({ order }: { order: Order }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={
          order === "az"
            ? "M7 4v15m0 0l-3.5-3.5M7 19l3.5-3.5"
            : "M7 20V5m0 0L3.5 8.5M7 5l3.5 3.5"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 4h6l-6 7h6M14 14h6M14 17h6M17 14v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Side panel of the state view (E-43, mockup sidebar-bundesland-kaernten): path, pin and state
 * name, tabs for municipalities and districts, search, A–Z/Z–A and the list of this state's
 * entries. Clicking an entry highlights it on the map; clicking it again clears the highlight.
 */
export function RegionSidebar({
  continent,
  countryName,
  country,
  adm1,
  name,
  highlightedId,
  onHighlight,
  onPick,
  initialTab = "municipalities",
  hidden = false,
}: RegionSidebarProps) {
  const region = useRegion(country, adm1);
  const isUs = country === US;
  const tabs: readonly Tab[] = isUs
    ? ["districts"]
    : ["municipalities", "districts"];
  const tabLabel = isUs ? US_TAB_LABEL : TAB_LABEL;
  const searchLabel = isUs ? US_SEARCH_LABEL : SEARCH_LABEL;
  const [chosenTab, setTab] = useState<Tab>(initialTab);
  const tab = tabs.includes(chosenTab) ? chosenTab : "districts";
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("az");
  const idBase = useId();
  const headingId = `${idBase}-heading`;
  const panelId = `${idBase}-panel`;

  const entries = useMemo(() => {
    const all = region.data?.[tab] ?? [];
    const needle = query.trim().toLocaleLowerCase("de");
    const matches = needle
      ? all.filter((entry) =>
          entry.name.toLocaleLowerCase("de").includes(needle),
        )
      : [...all];
    const direction = order === "az" ? 1 : -1;
    return matches.sort((a, b) => direction * collator.compare(a.name, b.name));
  }, [region.data, tab, query, order]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setQuery("");
  };

  return (
    <aside
      className="region-sidebar"
      data-testid="region-sidebar"
      aria-labelledby={headingId}
      hidden={hidden}
    >
      <div className="region-sidebar__head">
        <p className="region-sidebar__path">
          {`${continent.toUpperCase()} / ${countryName}`}
        </p>
        <div className="region-sidebar__title-row">
          <h2 id={headingId} className="region-sidebar__title">
            <PinIcon className="region-sidebar__pin" />
            <span>{name}</span>
          </h2>
          <div className="region-sidebar__tabs" role="tablist">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                className="region-sidebar__tab"
                aria-selected={tab === key}
                aria-controls={panelId}
                title={
                  isUs && key === "districts"
                    ? t("region.tab.counties.hint")
                    : undefined
                }
                onClick={() => {
                  selectTab(key);
                }}
              >
                {t(tabLabel[key])}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="region-sidebar__tools">
        <label className="region-sidebar__search">
          <span className="region-sidebar__search-icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="region-sidebar__search-input"
            placeholder={t(searchLabel[tab])}
            aria-label={t(searchLabel[tab])}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="region-sidebar__sort"
          aria-label={`${t("region.sort.ariaLabel")}: ${t(ORDER_LABEL[order])}`}
          onClick={() => {
            setOrder(order === "az" ? "za" : "az");
          }}
        >
          <span>{t(ORDER_LABEL[order])}</span>
          <SortIcon order={order} />
        </button>
      </div>
      <div id={panelId} role="tabpanel" className="region-sidebar__panel">
        {region.isPending && (
          <StatusBanner tone="info">{t("region.loading")}</StatusBanner>
        )}
        {region.isError && (
          <div className="region-sidebar__error">
            <StatusBanner tone="error">
              {apiUserMessage(region.error, t("region.error"))}
            </StatusBanner>
            {(region.error instanceof ApiRequestError
              ? region.error.retryable
              : true) && (
              <Button
                variant="secondary"
                onClick={() => {
                  void region.refetch();
                }}
              >
                {t("region.retry")}
              </Button>
            )}
          </div>
        )}
        {region.isSuccess && entries.length === 0 && (
          <p className="region-sidebar__empty">{t("region.empty")}</p>
        )}
        {region.isSuccess && entries.length > 0 && (
          <ul className="region-sidebar__list">
            {entries.map((entry) => {
              const active = entry.id === highlightedId;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    ref={active ? revealEntry : undefined}
                    className="region-sidebar__item"
                    aria-pressed={active}
                    onClick={() => {
                      onHighlight(active ? null : entry.id);
                      if (!active) {
                        onPick?.({
                          kind: "area",
                          id: entry.id,
                          name: entry.name,
                          centroid: entry.centroid,
                        });
                      }
                    }}
                  >
                    {entry.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
