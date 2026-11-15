import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../src/app/providers";
import {
  CompareSelectionProvider,
  useCompareSelection,
} from "../src/features/compare/CompareSelection";
import { CompareTimeline } from "../src/features/compare/CompareTimeline";
import type { CatalogResponse } from "../src/features/compare/contract";
import { t } from "../src/i18n";
import { CalculateStub } from "./calculate-stub";

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
  year_bounds: { min_year: 1981, max_year: 2025, max_years_per_request: 50 },
  default_baseline: { start_year: 1991, end_year: 2020 },
  method: {
    analysis_version: "annual-ols-hac-v1",
    method: "ols_hac",
    description: "test",
    min_years: 30,
    hac_maxlags: 3,
    confidence_level: 0.95,
    slope_unit: "per_decade",
  },
};

const temperature = catalog.variables[0];
if (temperature === undefined) {
  throw new Error("catalog fixture needs a variable");
}

const FROM = 1981;
const TO = 2025;
/** Track is 800 px wide over the variable's available years. */
const x = (year: number, from: number = FROM, to: number = TO) =>
  ((year - from) / (to - from)) * 800;

let applied: (() => void) | null = null;

function renderTimeline() {
  applied = vi.fn();
  render(
    <CompareSelectionProvider onApply={applied}>
      <CompareTimeline />
      <CalculateStub />
    </CompareSelectionProvider>,
    { wrapper: AppProviders },
  );
  return screen.findByTestId("compare-timeline");
}

const handle = (name: "timeline.start" | "timeline.end") =>
  screen.getByRole("slider", { name: t(name) });
const field = (name: "timeline.start" | "timeline.end") =>
  screen.getByRole("textbox", { name: t(name) });
const years = () => [
  handle("timeline.start").getAttribute("aria-valuenow"),
  handle("timeline.end").getAttribute("aria-valuenow"),
];

function keys(el: HTMLElement, ...list: string[]) {
  for (const key of list) fireEvent.keyDown(el, { key });
}

describe("timeline v2 (TL-2)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url === "/api/v1/catalog" ? catalog : {}),
            { status: url === "/api/v1/catalog" ? 200 : 404 },
          ),
        ),
      ),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 40,
      width: 800,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function tickYears(timeline: HTMLElement): number[] {
    return [
      ...within(timeline).getAllByTestId("year-tick"),
      ...within(timeline).getAllByTestId("year-tick-major"),
    ]
      .map((tick) => Number(tick.dataset["year"]))
      .sort((a, b) => a - b);
  }

  function disabledYears(timeline: HTMLElement): number[] {
    return [
      ...within(timeline).getAllByTestId("year-tick"),
      ...within(timeline).getAllByTestId("year-tick-major"),
    ]
      .filter((tick) => tick.dataset["disabled"] !== undefined)
      .map((tick) => Number(tick.dataset["year"]));
  }

  it("the scale starts and ends at the variable's available years, with no greyed-out years", async () => {
    const timeline = await renderTimeline();
    const ticks = tickYears(timeline);
    expect(ticks[0]).toBe(FROM);
    expect(ticks.at(-1)).toBe(TO);
    expect(ticks).toHaveLength(TO - FROM + 1);
    expect(disabledYears(timeline)).toEqual([]);
    expect(timeline.querySelector(".year-slider__out")).toBeNull();
    expect(years()).toEqual([String(FROM), String(TO)]);
  });

  it("click left of the range sets the start, right sets the end (nearer handle jumps)", async () => {
    const track = await renderTimeline().then(() =>
      screen.getByTestId("year-track"),
    );
    keys(handle("timeline.start"), "PageUp"); // 1991
    keys(handle("timeline.end"), "PageDown"); // 2015
    expect(years()).toEqual(["1991", "2015"]);

    fireEvent.pointerDown(track, { clientX: x(1986) });
    expect(years()).toEqual(["1986", "2015"]);
    fireEvent.pointerDown(track, { clientX: x(2020) });
    expect(years()).toEqual(["1986", "2020"]);

    fireEvent.pointerUp(window);
  });

  it("a click inside the range makes the nearer handle jump there; handles never jump (UI-DESIGN-2)", async () => {
    await renderTimeline();
    keys(handle("timeline.start"), "PageUp"); // 1991
    keys(handle("timeline.end"), "PageDown"); // 2015
    const range = screen.getByTestId("year-range");
    const clickRange = (year: number) => {
      fireEvent.pointerDown(range, { clientX: x(year) });
      fireEvent.pointerUp(window, { clientX: x(year) });
    };

    clickRange(1995); // 4 from the start, 20 from the end
    expect(years()).toEqual(["1995", "2015"]);
    clickRange(2010); // nearer the end
    expect(years()).toEqual(["1995", "2010"]);
    clickRange(2000); // 1995..2010: 5 vs 10 -> start
    expect(years()).toEqual(["2000", "2010"]);
    clickRange(2005); // exact middle of 2000..2010: the start
    expect(years()).toEqual(["2005", "2010"]);

    // A press on a handle without moving keeps its year.
    fireEvent.pointerDown(handle("timeline.end"), { clientX: x(2007) });
    fireEvent.pointerUp(window, { clientX: x(2007) });
    expect(years()).toEqual(["2005", "2010"]);

    // Dragging the range still moves it as a whole and does not jump on release.
    fireEvent.pointerDown(range, { clientX: x(2006) });
    fireEvent.pointerMove(window, { clientX: x(2008) });
    fireEvent.pointerUp(window, { clientX: x(2008) });
    expect(years()).toEqual(["2007", "2012"]);
  });

  it("years outside the available span are not selectable: keys and fields clamp", async () => {
    await renderTimeline();
    keys(handle("timeline.start"), "PageUp");
    keys(handle("timeline.end"), "PageDown");
    keys(handle("timeline.start"), "Home", "ArrowLeft");
    keys(handle("timeline.end"), "End", "ArrowRight");
    expect(years()).toEqual([String(FROM), String(TO)]);
    fireEvent.change(field("timeline.start"), { target: { value: "1955" } });
    fireEvent.blur(field("timeline.start"));
    expect(years()).toEqual([String(FROM), String(TO)]);
    expect((field("timeline.start") as HTMLInputElement).value).toBe(
      String(FROM),
    );
  });

  it("drags a handle and the whole range (width kept, clamped at the bounds)", async () => {
    await renderTimeline();
    fireEvent.pointerDown(handle("timeline.end"), { clientX: x(2025) });
    fireEvent.pointerMove(window, { clientX: x(2001) });
    fireEvent.pointerUp(window);
    expect(years()).toEqual(["1981", "2001"]);

    const range = screen.getByTestId("year-range");
    fireEvent.pointerDown(range, { clientX: x(1990) });
    fireEvent.pointerMove(window, { clientX: x(1995) });
    expect(years()).toEqual(["1986", "2006"]);
    fireEvent.pointerMove(window, { clientX: x(2030) }); // would end at 2041
    expect(years()).toEqual(["2005", "2025"]);
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: x(1990) }); // drag over
    expect(years()).toEqual(["2005", "2025"]);
  });

  it("syncs fields and bar both ways, Enter/blur commit and clamp (start <= end)", async () => {
    await renderTimeline();
    keys(handle("timeline.start"), "PageUp");
    expect((field("timeline.start") as HTMLInputElement).value).toBe("1991");

    fireEvent.change(field("timeline.end"), { target: { value: "2010" } });
    expect(years()).toEqual(["1991", "2025"]); // not committed yet
    fireEvent.keyDown(field("timeline.end"), { key: "Enter" });
    expect(years()).toEqual(["1991", "2010"]);

    fireEvent.change(field("timeline.start"), { target: { value: "2015" } });
    fireEvent.blur(field("timeline.start"));
    expect(years()).toEqual(["2010", "2010"]);

    fireEvent.change(field("timeline.end"), { target: { value: "abc" } });
    fireEvent.blur(field("timeline.end"));
    expect((field("timeline.end") as HTMLInputElement).value).toBe("2010");
  });

  it("CALCULATE applies the selection; dragging alone does not", async () => {
    const timeline = await renderTimeline();
    // UI-DESIGN-7: the timeline has no CALCULATE button any more (it lives in the side panel).
    expect(
      within(timeline).queryByRole("button", {
        name: t("timeline.calculate"),
      }),
    ).toBeNull();
    keys(handle("timeline.start"), "PageUp");
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: t("timeline.calculate") }),
    );
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("drops the 'Timeframe from … to …' text, the info button and every add-month control (UI-DESIGN-12, UI-DESIGN-15)", async () => {
    const timeline = await renderTimeline();
    expect(
      within(timeline).queryByRole("button", { name: t("timeline.addMonth") }),
    ).toBeNull();
    expect(timeline.querySelector(".timeline__add-month")).toBeNull();
    expect(timeline.querySelector(".timeline__tooltip")).toBeNull();
    // Only the two year fields remain next to the bar.
    expect(
      timeline.querySelectorAll(".timeline__controls button"),
    ).toHaveLength(0);
    expect(
      within(timeline).queryByRole("button", { name: t("timeline.info") }),
    ).toBeNull();
    expect(timeline.textContent).not.toContain(t("layout.timeframe.label"));
    expect(timeline.querySelector(".timeline__month")).toBeNull();
    // The fields keep their group name for screen readers.
    expect(
      timeline.querySelector(".timeline__fields")?.getAttribute("aria-label"),
    ).toBe(t("layout.timeframe.label"));
  });

  it("falls back to catalog year_bounds when the variable has no available years", async () => {
    const withoutFields: CatalogResponse = {
      ...catalog,
      variables: [
        {
          id: temperature.id,
          label: temperature.label,
          description: temperature.description,
          provider_parameter: temperature.provider_parameter,
          unit: temperature.unit,
          aggregation: temperature.aggregation,
          enabled: temperature.enabled,
        } as CatalogResponse["variables"][number],
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url === "/api/v1/catalog" ? withoutFields : {}),
            { status: url === "/api/v1/catalog" ? 200 : 404 },
          ),
        ),
      ),
    );
    const timeline = await renderTimeline();
    const ticks = tickYears(timeline);
    expect(ticks[0]).toBe(catalog.year_bounds.min_year);
    expect(ticks.at(-1)).toBe(catalog.year_bounds.max_year);
    expect(disabledYears(timeline)).toEqual([]);
    expect(years()).toEqual(["1981", "2025"]);
  });

  it("uses a variable's own available years and clamps the range when the variable changes", async () => {
    const narrow: CatalogResponse = {
      ...catalog,
      variables: [
        temperature,
        {
          ...temperature,
          id: "precipitation",
          label: "Precipitation",
          provider_parameter: "PRECTOTCORR",
          unit: "mm/year",
          aggregation: "calendar_day_sum",
          available_from_year: 2000,
          available_to_year: 2010,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url === "/api/v1/catalog" ? narrow : {}),
            { status: url === "/api/v1/catalog" ? 200 : 404 },
          ),
        ),
      ),
    );

    function SwitchToPrecipitation() {
      const { setVariable } = useCompareSelection();
      return (
        <button
          type="button"
          onClick={() => {
            setVariable("precipitation");
          }}
        >
          switch
        </button>
      );
    }

    applied = vi.fn();
    render(
      <CompareSelectionProvider onApply={applied}>
        <CompareTimeline />
        <CalculateStub />
        <SwitchToPrecipitation />
      </CompareSelectionProvider>,
      { wrapper: AppProviders },
    );
    const timeline = await screen.findByTestId("compare-timeline");
    expect(tickYears(timeline)[0]).toBe(FROM);
    expect(tickYears(timeline).at(-1)).toBe(TO);
    keys(handle("timeline.start"), "PageUp"); // 1991
    keys(handle("timeline.end"), "PageDown"); // 2015
    expect(years()).toEqual(["1991", "2015"]);

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(tickYears(timeline)[0]).toBe(2000);
    expect(tickYears(timeline).at(-1)).toBe(2010);
    expect(disabledYears(timeline)).toEqual([]);
    expect(years()).toEqual(["2000", "2010"]);
  });
});
