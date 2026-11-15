import { useMemo } from "react";

import {
  pathData,
  projectionForGeometry,
  viewBoxAttribute,
  type Projection,
} from "./countryProjection";
import type { PolygonGeometry } from "./globeLevels";
import { useMapHoverTooltip } from "./MapHoverTooltip";

/** A district or municipality as the map needs it; names are data, not UI text. */
export type MapArea = { id: string; name: string; geometry: PolygonGeometry };

type StateMapProps = {
  /** Accessible name of the map: the state's name. */
  name: string;
  /** Outline that sets projection and frame (Natural Earth), so the frame does not jump on load. */
  outline: PolygonGeometry;
  /** Other states of the country, drawn faintly around the state; not clickable. */
  surroundings: readonly PolygonGeometry[];
  /** The state's boundary from the API; until it arrives the outline is drawn. */
  boundary?: PolygonGeometry | undefined;
  districts: readonly MapArea[];
  municipalities: readonly MapArea[];
  /** id of a district or municipality to highlight (from the sidebar list), or null. */
  highlightedId: string | null;
  /** Called with the id of a clicked municipality or county (UI-SEL, UI-CNTY). */
  onSelectArea?: ((id: string) => void) | undefined;
};

type ProjectedArea = { id: string; name: string; d: string };

function projectAreas(
  projection: Projection,
  areas: readonly MapArea[],
): ProjectedArea[] {
  return areas.map(({ id, name, geometry }) => ({
    id,
    name,
    d: pathData(projection, geometry),
  }));
}

/**
 * Level 4 (E-43): one state as a flat SVG map in the same projection as the country map:
 * municipality areas, district borders above them and the state boundary on top. UI only; the
 * data comes in through props.
 */
export function StateMap({
  name,
  outline,
  surroundings,
  boundary,
  districts,
  municipalities,
  highlightedId,
  onSelectArea,
}: StateMapProps) {
  const { projection, viewBox } = useMemo(
    () => projectionForGeometry(outline),
    [outline],
  );
  // Projected once per state: Lower Austria has several hundred municipalities.
  const municipalityPaths = useMemo(
    () => projectAreas(projection, municipalities),
    [projection, municipalities],
  );
  const districtPaths = useMemo(
    () => projectAreas(projection, districts),
    [projection, districts],
  );
  const surroundingPaths = useMemo(
    () => surroundings.map((geometry) => pathData(projection, geometry)),
    [projection, surroundings],
  );
  const boundaryPath = useMemo(
    () => pathData(projection, boundary ?? outline),
    [projection, boundary, outline],
  );
  // Built once per state, so a highlight change does not re-render hundreds of paths (Texas: 254).
  const areaLayers = useMemo(
    () => (
      <>
        <g className="state-map__municipalities">
          {municipalityPaths.map((area) => (
            <path
              key={area.id}
              className="state-map__municipality"
              data-id={area.id}
              d={area.d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              data-map-tooltip={area.name}
              aria-label={area.name}
            />
          ))}
        </g>
        <g className="state-map__districts" aria-hidden="true">
          {districtPaths.map((area) => (
            <path
              key={area.id}
              d={area.d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </>
    ),
    [municipalityPaths, districtPaths],
  );
  const highlighted =
    highlightedId === null
      ? undefined
      : (districtPaths.find((area) => area.id === highlightedId) ??
        municipalityPaths.find((area) => area.id === highlightedId));

  const { tooltip, onPointerMove, onPointerLeave } = useMapHoverTooltip();
  return (
    <div className="map-tooltip-host">
      <svg
        className="country-map state-map"
        data-testid="state-map"
        role="group"
        aria-label={name}
        viewBox={viewBoxAttribute(viewBox)}
        preserveAspectRatio="xMidYMid meet"
        // One delegated handler, so the memoised area layers do not depend on the callback.
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          const id = (event.target as Element)
            .closest(".state-map__municipality")
            ?.getAttribute("data-id");
          if (id != null) onSelectArea?.(id);
        }}
      >
        <g className="state-map__surroundings" aria-hidden="true">
          {surroundingPaths.map((d, index) => (
            <path
              key={index}
              d={d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <path
          className="state-map__area"
          d={boundaryPath}
          fillRule="evenodd"
          vectorEffect="non-scaling-stroke"
        />
        {areaLayers}
        <path
          className="state-map__boundary"
          d={boundaryPath}
          fillRule="evenodd"
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
        />
        {highlighted !== undefined && (
          <path
            className="state-map__highlight"
            data-testid="state-map-highlight"
            d={highlighted.d}
            fillRule="evenodd"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {tooltip}
    </div>
  );
}
