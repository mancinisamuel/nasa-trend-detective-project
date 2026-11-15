import { StateMap } from "../../components/StateMap";
import type { MapPick, PolygonGeometry } from "../../components/globeLevels";
import type { RegionResponse } from "./contract";
import { useRegion } from "./useRegion";

type StateMapViewProps = {
  country: string;
  adm1: string;
  name: string;
  /** Natural Earth outline of the state (frames the map before the API answers), if known. */
  outline: PolygonGeometry | null;
  surroundings: readonly PolygonGeometry[];
  highlightedId: string | null;
  /** A municipality or county clicked on the map, with its centroid (UI-SEL, UI-CNTY). */
  onPick?: (pick: MapPick) => void;
};

const NO_AREAS: never[] = [];

/**
 * The filled, clickable layer is the finest subdivision the API sent: municipalities where they
 * exist (Austria), otherwise districts (US counties). District borders are drawn only on top of
 * a finer fill, same as in Austria.
 */
function mapLayers(region: RegionResponse | undefined) {
  const municipalities = region?.municipalities ?? NO_AREAS;
  const districts = region?.districts ?? NO_AREAS;
  return municipalities.length > 0
    ? { areas: municipalities, borders: districts }
    : { areas: districts, borders: NO_AREAS };
}

/**
 * The state map with its data (E-43). Loading and error states are shown in the sidebar; the map
 * meanwhile shows the state's outline.
 */
export function StateMapView({
  country,
  adm1,
  name,
  outline,
  surroundings,
  highlightedId,
  onPick,
}: StateMapViewProps) {
  const region = useRegion(country, adm1);
  const frame = outline ?? region.data?.boundary;
  const { areas, borders } = mapLayers(region.data);
  if (frame === undefined) return null;
  return (
    <StateMap
      name={name}
      outline={frame}
      surroundings={surroundings}
      boundary={region.data?.boundary}
      districts={borders}
      municipalities={areas}
      highlightedId={highlightedId}
      onSelectArea={(id) => {
        const area = areas.find((entry) => entry.id === id);
        if (area !== undefined) {
          onPick?.({
            kind: "area",
            id: area.id,
            name: area.name,
            centroid: area.centroid,
          });
        }
      }}
    />
  );
}
