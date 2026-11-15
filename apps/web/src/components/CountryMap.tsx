import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "../i18n";
import {
  countriesInView,
  labelPoint,
  pathData,
  projectionForCountry,
  viewBoxAttribute,
} from "./countryProjection";
import {
  NON_SELECTABLE_CONTINENTS,
  US,
  type CountryFeature,
  type RegionFeature,
} from "./globeLevels";
import { useMapHoverTooltip } from "./MapHoverTooltip";

/** On-screen font size of the "Previously selected" label. */
const LABEL_PX = 11;

type CountryMapProps = {
  country: CountryFeature;
  regions: readonly RegionFeature[];
  /** All countries; the ones overlapping the frame are drawn faintly around the chosen country. */
  countries: readonly CountryFeature[];
  /** ADM0_A3 of the country shown just before; drawn stronger than the other neighbours. */
  previousCountry?: string | undefined;
  onSelectNeighbour: (neighbour: CountryFeature) => void;
  /** Only for countries with a state view (E-43): makes the states clickable. */
  onSelectRegion?: ((region: RegionFeature) => void) | undefined;
};

/**
 * Level 3: the chosen country's admin-1 regions as a flat SVG map, with the surrounding countries
 * faint in the same projection. Clicking a neighbour opens its map; clicking a region opens its
 * state view only when `onSelectRegion` is given (E-43, Austria), otherwise it does nothing.
 */
export function CountryMap({
  country,
  regions,
  countries,
  previousCountry,
  onSelectNeighbour,
  onSelectRegion,
}: CountryMapProps) {
  const { projection, viewBox } = useMemo(
    () => projectionForCountry(country),
    [country],
  );
  const neighbours = useMemo(
    () =>
      countriesInView(
        projection,
        // The SVG letterboxes the frame to the screen ratio; include what is visible beside it.
        {
          x: viewBox.x - viewBox.width,
          y: viewBox.y - viewBox.height / 2,
          width: viewBox.width * 3,
          height: viewBox.height * 2,
        },
        countries,
        country.properties.ADM0_A3,
      ).map((feature) => ({
        feature,
        d: pathData(projection, feature.geometry),
      })),
    [projection, viewBox, countries, country],
  );
  const previous = neighbours.find(
    ({ feature }) => feature.properties.ADM0_A3 === previousCountry,
  )?.feature;
  const previousLabel = useMemo(
    () =>
      previous === undefined
        ? null
        : labelPoint(projection, previous.geometry, viewBox),
    [previous, projection, viewBox],
  );
  // Screen pixels per map unit; the map scales with the card (e.g. when the sheet opens).
  const svgRef = useRef<SVGSVGElement>(null);
  const [pxPerUnit, setPxPerUnit] = useState<number | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const scale = Math.min(
        svg.clientWidth / viewBox.width,
        svg.clientHeight / viewBox.height,
      );
      setPxPerUnit(Number.isFinite(scale) && scale > 0 ? scale : null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, [viewBox]);
  // Fixed on-screen size (E-35: about 70 % of the former ~16 px), whatever the map's scale.
  const labelSize =
    pxPerUnit === null
      ? Math.max(viewBox.width, viewBox.height) * 0.0154
      : LABEL_PX / pxPerUnit;
  const { tooltip, onPointerMove, onPointerLeave } = useMapHoverTooltip();
  return (
    <div className="map-tooltip-host">
      <svg
        ref={svgRef}
        className="country-map"
        data-testid="country-map"
        role="group"
        aria-label={t("globe.countryMap.ariaLabel")}
        viewBox={viewBoxAttribute(viewBox)}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <g className="country-map__neighbours">
          {neighbours.map(({ feature, d }) => {
            const { NAME, ADM0_A3, CONTINENT } = feature.properties;
            if (NON_SELECTABLE_CONTINENTS.has(CONTINENT)) {
              return (
                <path
                  key={ADM0_A3}
                  className="country-map__neighbour country-map__neighbour--inert"
                  d={d}
                  fillRule="evenodd"
                  vectorEffect="non-scaling-stroke"
                  data-map-tooltip={NAME}
                  aria-label={NAME}
                />
              );
            }
            const select = () => {
              onSelectNeighbour(feature);
            };
            return (
              <path
                key={ADM0_A3}
                className={
                  ADM0_A3 === previousCountry
                    ? "country-map__neighbour country-map__neighbour--previous"
                    : "country-map__neighbour"
                }
                data-country={ADM0_A3}
                d={d}
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={0}
                data-map-tooltip={NAME}
                aria-label={`${NAME}: ${t("globe.countryMap.showNeighbor")}`}
                onClick={select}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select();
                  }
                }}
              />
            );
          })}
        </g>
        {regions.map((region, index) => {
          const { name, iso_3166_2: code } = region.properties;
          const key = `${code}-${String(index)}`;
          const d = pathData(projection, region.geometry);
          // Natural Earth name on the custom tooltip (E-75); names are data, not UI text.
          if (onSelectRegion === undefined) {
            return (
              <path
                key={key}
                className="country-map__region"
                d={d}
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
                data-map-tooltip={name}
                aria-label={name}
              />
            );
          }
          const select = () => {
            onSelectRegion(region);
          };
          return (
            <path
              key={key}
              className="country-map__region country-map__region--selectable"
              data-region={code}
              d={d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={0}
              data-map-tooltip={name}
              aria-label={`${name}: ${t(
                country.properties.ADM0_A3 === US
                  ? "region.countryMap.openUsState"
                  : "globe.countryMap.showNeighbor",
              )}`}
              onClick={select}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select();
                }
              }}
            />
          );
        })}
        {previousLabel !== null && (
          <text
            className="country-map__previous-label"
            data-testid="previous-label"
            x={previousLabel[0]}
            y={previousLabel[1]}
            fontSize={labelSize}
            strokeWidth={labelSize * 0.28}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {t("map.previouslySelected")}
          </text>
        )}
      </svg>
      {tooltip}
    </div>
  );
}
