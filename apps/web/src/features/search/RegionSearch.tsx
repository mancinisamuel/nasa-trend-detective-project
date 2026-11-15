import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { US } from "../../components/globeLevels";
import { SearchIcon } from "../../components/layout/SearchbarPlaceholder";
import { Button } from "../../components/ui/Button";
import { t, type MessageKey } from "../../i18n";
import { ApiRequestError, apiUserMessage } from "../../lib/apiClient";
import type { RegionSearchHit } from "../region/contract";
import { useRegionSearch } from "./useRegionSearch";

type RegionSearchProps = {
  /** Display name of a country (Natural Earth NAME) for the hit's path line. */
  countryName: (iso3: string) => string;
  /** A hit was chosen by click or Enter. */
  onSelect: (hit: RegionSearchHit) => void;
  /** Focus the field once it is shown (UI-DESIGN-3: after the search icon was clicked). */
  autoFocus?: boolean;
  /** Called after that focus was set, so it happens only once. */
  onAutoFocused?: () => void;
};

/** Screen-reader name of the hit's type; US districts are counties, US states are states. */
function typeLabel(hit: RegionSearchHit): MessageKey {
  const isUs = hit.country_iso3 === US;
  if (hit.type === "municipality") return "search.type.municipality";
  if (hit.type === "district") {
    return isUs ? "search.type.county" : "search.type.district";
  }
  return isUs ? "search.type.usState" : "search.type.state";
}

/** Crosshair for a municipality, an area outline for districts, counties and states. */
function HitIcon({ type }: { type: RegionSearchHit["type"] }) {
  return (
    <svg
      className="region-search__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {type === "municipality" ? (
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5" strokeLinecap="round" />
        </g>
      ) : (
        <path
          d="M5 6l6-3 8 4-1 8-6 6-7-4z"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Search field over the globe (E-52b, mockup searchbar-mockup): ARIA combobox with a listbox of
 * hits. Arrow keys move, Enter picks, Esc closes; a pick navigates like a click on globe and map.
 */
export function RegionSearch({
  countryName,
  onSelect,
  autoFocus = false,
  onAutoFocused,
}: RegionSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Runs after mount too, so the focus also lands when the field appears only after the delayed
  // switch to the globe view.
  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    onAutoFocused?.();
  }, [autoFocus, onAutoFocused]);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { tooShort, pending, result } = useRegionSearch(input);
  const idBase = useId();
  const listboxId = `${idBase}-listbox`;
  const optionId = (index: number) => `${idBase}-option-${String(index)}`;

  const hits =
    !tooShort && !pending && result.isSuccess ? result.data.results : [];
  const active = activeIndex < hits.length ? activeIndex : -1;
  const expanded = open && input.trim().length > 0;
  const showList = expanded && hits.length > 0;

  const select = (hit: RegionSearchHit) => {
    setOpen(false);
    setInput("");
    setActiveIndex(-1);
    onSelect(hit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (hits.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        Math.min(
          hits.length - 1,
          Math.max(0, (active < 0 ? -1 : active) + step),
        ),
      );
    } else if (event.key === "Enter") {
      const hit = hits[active];
      if (expanded && hit !== undefined) {
        event.preventDefault();
        select(hit);
      }
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  let status: MessageKey | null = null;
  if (tooShort) status = "search.minChars";
  else if (pending) status = "search.loading";
  else if (result.isError) status = "search.error";
  else if (hits.length === 0) status = "search.empty";
  const retryable =
    result.error instanceof ApiRequestError ? result.error.retryable : true;

  return (
    <div className="region-search" data-testid="region-search">
      <SearchIcon />
      <input
        ref={inputRef}
        className="region-search__input"
        type="text"
        role="combobox"
        aria-label={t("search.ariaLabel")}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={
          showList && active >= 0 ? optionId(active) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder={t("search.placeholder")}
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        // Mouse down would blur the input and close the dropdown before the click lands.
        <div
          className="region-search__dropdown"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("search.resultsAriaLabel")}
            className="region-search__list"
            hidden={!showList}
          >
            {hits.map((hit, index) => (
              <li
                key={`${hit.type}-${hit.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="region-search__option"
                onClick={() => {
                  select(hit);
                }}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
              >
                <span className="region-search__name">
                  <HitIcon type={hit.type} />
                  <span className="visually-hidden">
                    {`${t(typeLabel(hit))}: `}
                  </span>
                  {hit.name}
                </span>
                <span className="region-search__path">
                  {[
                    hit.continent.toUpperCase(),
                    countryName(hit.country_iso3),
                    ...(hit.type === "state" ? [] : [hit.adm1_name]),
                  ].join(" / ")}
                </span>
              </li>
            ))}
          </ul>
          {status !== null && (
            <div className="region-search__status" role="status">
              <p>
                {result.isError
                  ? apiUserMessage(result.error, t("search.error"))
                  : t(status)}
              </p>
              {status === "search.error" && retryable && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void result.refetch();
                  }}
                >
                  {t("region.retry")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
