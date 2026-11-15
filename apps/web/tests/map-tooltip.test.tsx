import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountryMap } from "../src/components/CountryMap";
import { StateMap } from "../src/components/StateMap";
import type {
  CountryFeature,
  PolygonGeometry,
  RegionFeature,
} from "../src/components/globeLevels";

function square(
  west: number,
  south: number,
  east: number,
  north: number,
): PolygonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

const mexico: CountryFeature = {
  type: "Feature",
  properties: { NAME: "Mexico", ADM0_A3: "MEX", CONTINENT: "North America" },
  geometry: square(-103, 25, -100, 28),
};

const unitedStates: CountryFeature = {
  type: "Feature",
  properties: {
    NAME: "United States of America",
    ADM0_A3: "USA",
    CONTINENT: "North America",
  },
  geometry: square(-110, 31, -102, 38),
};

const newMexico: RegionFeature = {
  type: "Feature",
  properties: { name: "New Mexico", adm0_a3: "USA", iso_3166_2: "US-NM" },
  geometry: square(-109, 31, -103, 37),
};

const texas: RegionFeature = {
  type: "Feature",
  properties: { name: "Texas", adm0_a3: "USA", iso_3166_2: "US-TX" },
  geometry: square(-106, 25, -93, 31),
};

describe("map hover tooltip (E-75)", () => {
  it("shows the region name at once and switches neighbour without hiding", () => {
    render(
      <CountryMap
        country={unitedStates}
        regions={[newMexico, texas]}
        countries={[unitedStates, mexico]}
        onSelectNeighbour={() => {}}
        onSelectRegion={() => {}}
      />,
    );

    const map = screen.getByTestId("country-map");
    expect(map.querySelectorAll("title")).toHaveLength(0);

    const tooltip = screen.getByTestId("map-tooltip");
    expect(tooltip.hidden).toBe(true);

    const first = map.querySelector('[data-region="US-NM"]');
    const second = map.querySelector('[data-region="US-TX"]');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    fireEvent.pointerMove(first as Element, { clientX: 40, clientY: 40 });
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("New Mexico");

    fireEvent.pointerMove(second as Element, { clientX: 80, clientY: 50 });
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("Texas");

    fireEvent.pointerLeave(map);
    expect(tooltip.hidden).toBe(true);
  });

  it("shows the municipality name on the state map without a native title", () => {
    render(
      <StateMap
        name="Texas"
        outline={square(-106, 25, -93, 37)}
        surroundings={[]}
        districts={[]}
        municipalities={[
          { id: "travis", name: "Travis", geometry: square(-98, 30, -97, 31) },
        ]}
        highlightedId={null}
      />,
    );

    const map = screen.getByTestId("state-map");
    expect(map.querySelectorAll("title")).toHaveLength(0);

    const path = map.querySelector('[data-id="travis"]');
    const tooltip = screen.getByTestId("map-tooltip");
    expect(path).not.toBeNull();

    fireEvent.pointerMove(path as Element, { clientX: 20, clientY: 20 });
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("Travis");
  });
});
