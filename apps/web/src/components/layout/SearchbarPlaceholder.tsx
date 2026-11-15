import type { ReactNode } from "react";

import { t } from "../../i18n";

type SearchbarPlaceholderProps = {
  /** Collapsed to a search icon while the sheet is open (E-35) or a country or deeper is shown (E-48). */
  collapsed: boolean;
  /** Click on the collapsed icon; from a country or deeper it returns to the continent (E-48). */
  onIconClick?: (() => void) | undefined;
  /** The search field shown while the bar is open (E-52b); without it the placeholder text. */
  children?: ReactNode;
};

/** Magnifier of the search bar and its collapsed icon. */
export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
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

/** Search bar slot: the search field, or the icon while collapsed. On the globe and continent the icon does nothing. */
export function SearchbarPlaceholder({
  collapsed,
  onIconClick,
  children,
}: SearchbarPlaceholderProps) {
  return (
    <div
      className="layout-placeholder app-layout__searchbar"
      data-collapsed={collapsed}
      data-testid="searchbar"
    >
      {collapsed ? (
        <button
          type="button"
          className="app-layout__search-icon"
          aria-label={t("layout.search")}
          onClick={onIconClick}
        >
          <SearchIcon />
        </button>
      ) : (
        (children ?? (
          <span className="app-layout__searchbar-text">
            {t("layout.searchbar")}
          </span>
        ))
      )}
    </div>
  );
}
