import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type YearRange = { start: number; end: number };

/** Which part moved: one handle, or the whole range (width kept). */
export type RangeChange = "start" | "end" | "both";

type YearRangeSliderProps = {
  /** Accessible name of the whole bar. */
  label: string;
  /** Accessible names of the two handles. */
  startLabel: string;
  endLabel: string;
  /** Visible scale (ticks); may be wider than the selectable bounds. */
  scaleMin: number;
  scaleMax: number;
  /** Selectable bounds; years outside are greyed out and never selected. */
  min: number;
  max: number;
  value: YearRange;
  onChange: (range: YearRange, changed: RangeChange) => void;
};

/** Every LABEL_STEP years the tick is longer and carries the year below it. */
const LABEL_STEP = 5;

type Drag =
  | { kind: "start" | "end" }
  | { kind: "range"; originYear: number; origin: YearRange };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function years(min: number, max: number): number[] {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}

/**
 * The handle a click on the bar moves (UI-DESIGN-2): the one nearer the clicked year. On a tie
 * the side decides: left of the range the start, right of it the end, the exact middle the start.
 */
export function nearerHandle(year: number, range: YearRange): "start" | "end" {
  const toStart = Math.abs(year - range.start);
  const toEnd = Math.abs(year - range.end);
  if (toStart !== toEnd) return toStart < toEnd ? "start" : "end";
  return year > range.end ? "end" : "start";
}

// UI primitive: no data logic. A tick bar with two handles (role=slider). Handles and the range
// are dragged with pointer events. A click anywhere on the bar (outside or inside the range) makes
// the nearer handle jump to that year (UI-DESIGN-2); a click on a handle never jumps. A press on
// the range that does not move counts as such a click. Keyboard: arrows 1 year, PageUp/PageDown
// 10, Home/End.
export function YearRangeSlider({
  label,
  startLabel,
  endLabel,
  scaleMin,
  scaleMax,
  min,
  max,
  value,
  onChange,
}: YearRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lastMoved, setLastMoved] = useState<"start" | "end">("end");
  // Whether a press on the range has moved it; without movement the release is a click.
  const rangeMoved = useRef(false);
  // The last moved handle lies on top. With both at max the start handle lies on top, so it can
  // still be moved to the left (the end handle could not move right anyway).
  const top = value.start >= max ? "start" : lastMoved;

  const span = Math.max(1, scaleMax - scaleMin);
  const percent = (year: number) => ((year - scaleMin) / span) * 100;

  function yearAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0) return scaleMin;
    return Math.round(scaleMin + ((clientX - rect.left) / rect.width) * span);
  }

  /** Moves one handle; it stays within [min, max] and never passes the other handle. */
  function move(handle: "start" | "end", year: number) {
    setLastMoved(handle);
    if (handle === "start") {
      onChange({ start: clamp(year, min, value.end), end: value.end }, "start");
    } else {
      onChange(
        { start: value.start, end: clamp(year, value.start, max) },
        "end",
      );
    }
  }

  useEffect(() => {
    if (drag === null) return;
    function onMove(event: PointerEvent) {
      if (drag === null) return;
      const year = yearAt(event.clientX);
      if (drag.kind === "range") {
        if (year !== drag.originYear) rangeMoved.current = true;
        if (!rangeMoved.current) return;
        const width = drag.origin.end - drag.origin.start;
        const start = clamp(
          drag.origin.start + year - drag.originYear,
          min,
          max - width,
        );
        onChange({ start, end: start + width }, "both");
      } else {
        move(drag.kind, year);
      }
    }
    function onUp() {
      if (drag?.kind === "range" && !rangeMoved.current) {
        move(nearerHandle(drag.originYear, value), drag.originYear);
      }
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  });

  function onTrackPointerDown(event: ReactPointerEvent) {
    const year = yearAt(event.clientX);
    const kind = nearerHandle(year, value);
    move(kind, year);
    // Keep the pointer on the handle that jumped, so press-and-drag continues from here.
    setDrag({ kind });
  }

  function onKey(handle: "start" | "end", event: KeyboardEvent) {
    const current = handle === "start" ? value.start : value.end;
    const next: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      PageDown: current - 10,
      PageUp: current + 10,
      Home: min,
      End: max,
    };
    const year = next[event.key];
    if (year === undefined) return;
    event.preventDefault();
    move(handle, year);
  }

  function handle(kind: "start" | "end") {
    const year = kind === "start" ? value.start : value.end;
    const name = kind === "start" ? startLabel : endLabel;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={kind === "start" ? min : value.start}
        aria-valuemax={kind === "start" ? value.end : max}
        aria-valuenow={year}
        aria-valuetext={`${name} ${String(year)}`}
        aria-orientation="horizontal"
        className={`year-slider__handle year-slider__handle--${kind}${top === kind ? " year-slider__handle--top" : ""}`}
        style={{ left: `${String(percent(year))}%` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setLastMoved(kind);
          setDrag({ kind });
        }}
        onKeyDown={(event) => {
          onKey(kind, event);
        }}
      >
        <span className="year-slider__handle-year" aria-hidden="true">
          {year}
        </span>
      </div>
    );
  }

  return (
    <div className="year-slider" role="group" aria-label={label}>
      <div
        ref={trackRef}
        className="year-slider__track"
        data-testid="year-track"
        data-dragging={drag?.kind ?? undefined}
        onPointerDown={onTrackPointerDown}
      >
        {scaleMin < min && (
          <div
            className="year-slider__out year-slider__out--before"
            style={{ width: `${String(percent(min - 0.5))}%` }}
            aria-hidden="true"
          />
        )}
        {scaleMax > max && (
          <div
            className="year-slider__out year-slider__out--after"
            style={{ left: `${String(percent(max + 0.5))}%` }}
            aria-hidden="true"
          />
        )}
        <div className="year-slider__ticks" aria-hidden="true">
          {years(scaleMin, scaleMax).map((year) => {
            const major = year % LABEL_STEP === 0;
            const outside = year < min || year > max;
            const inRange = year >= value.start && year <= value.end;
            const classes = [
              "year-slider__tick",
              major && "year-slider__tick--major",
              outside && "year-slider__tick--disabled",
              inRange && "year-slider__tick--in-range",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span
                key={year}
                className={classes}
                style={{ left: `${String(percent(year))}%` }}
                data-testid={major ? "year-tick-major" : "year-tick"}
                data-year={year}
                data-disabled={outside || undefined}
              >
                {major && (
                  <span className="year-slider__tick-label">{year}</span>
                )}
              </span>
            );
          })}
        </div>
        <div
          className="year-slider__fill"
          data-testid="year-range"
          style={{
            left: `${String(percent(value.start))}%`,
            width: `${String(percent(value.end) - percent(value.start))}%`,
          }}
          aria-hidden="true"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            rangeMoved.current = false;
            setDrag({
              kind: "range",
              originYear: yearAt(event.clientX),
              origin: value,
            });
          }}
        />
        {handle("start")}
        {handle("end")}
      </div>
    </div>
  );
}
