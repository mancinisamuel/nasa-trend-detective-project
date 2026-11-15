/** Series slot: A is petrol and solid, B is orange and dashed (tokens.css). */
export type SeriesSlot = "a" | "b";

/** Line sample used as legend marker, so colour is never the only encoding. */
export function SeriesMarker({ slot }: { slot: SeriesSlot }) {
  return (
    <svg
      className={`series-marker series-marker--${slot}`}
      width="28"
      height="10"
      viewBox="0 0 28 10"
      aria-hidden="true"
      focusable="false"
      data-testid={`series-marker-${slot}`}
    >
      <line x1="1" y1="5" x2="27" y2="5" />
    </svg>
  );
}
