import { useId, useMemo, useState } from "react";

import { US, type RegionFeature } from "../../components/globeLevels";
import { PinIcon } from "../../components/ui/PinIcon";
import { t } from "../../i18n";
import { SearchIcon, SortIcon } from "./RegionSidebar";

type Order = "az" | "za";
const ORDER_LABEL = { az: "region.sort.az", za: "region.sort.za" } as const;
const collator = new Intl.Collator("de", { sensitivity: "base" });

type CountrySidebarProps = {
  continent: string;
  country: string;
  name: string;
  /** The country's states from the same admin-1 data as the 2D country map. */
  states: readonly RegionFeature[];
  /** A click opens the state view right away, like a click on the state in the map. */
  onOpen: (state: RegionFeature) => void;
  /** Hidden while a calculated place is shown (kept mounted, search and order stay). */
  hidden?: boolean;
};

/**
 * Side panel of the country map (UI-DESIGN-9), same pattern as the state view: path and country
 * name, search, A–Z/Z–A and the list of the country's states, provinces or federal states.
 */
export function CountrySidebar({
  continent,
  country,
  name,
  states,
  onOpen,
  hidden = false,
}: CountrySidebarProps) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("az");
  const idBase = useId();
  const headingId = `${idBase}-heading`;
  const searchLabel = t(
    country === US ? "region.level.usStates" : "region.level.states",
  );
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    const matches = needle
      ? states.filter((state) =>
          state.properties.name.toLocaleLowerCase("de").includes(needle),
        )
      : [...states];
    const direction = order === "az" ? 1 : -1;
    return matches.sort(
      (a, b) =>
        direction * collator.compare(a.properties.name, b.properties.name),
    );
  }, [states, query, order]);

  return (
    <aside
      className="region-sidebar"
      data-testid="country-sidebar"
      aria-labelledby={headingId}
      hidden={hidden}
    >
      <div className="region-sidebar__head">
        <p className="region-sidebar__path">{continent.toUpperCase()}</p>
        <div className="region-sidebar__title-row">
          <h2 id={headingId} className="region-sidebar__title">
            <PinIcon className="region-sidebar__pin" />
            <span>{name}</span>
          </h2>
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
            placeholder={searchLabel}
            aria-label={searchLabel}
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
      <div className="region-sidebar__panel">
        {entries.length === 0 ? (
          <p className="region-sidebar__empty">
            {states.length === 0 ? t("region.loading") : t("region.empty")}
          </p>
        ) : (
          <ul className="region-sidebar__list">
            {entries.map((state) => {
              const iso = state.properties.iso_3166_2;
              return (
                <li key={iso}>
                  <button
                    type="button"
                    className="region-sidebar__item"
                    onClick={() => {
                      onOpen(state);
                    }}
                  >
                    {state.properties.name}
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
