import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/** Attribute on a map path whose value is the hover label (region names are data). */
export const MAP_TOOLTIP_ATTR = "data-map-tooltip";

/**
 * Instant hover tooltip for 2D maps (E-75). Position is written to the DOM so moving the pointer
 * does not re-render the map; changing region only updates the label, with no hide/show gap.
 */
export function useMapHoverTooltip(): {
  tooltip: ReactNode;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: () => void;
} {
  const tipRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<string | null>(null);
  const hideFrame = useRef<number | null>(null);

  const cancelHide = useCallback(() => {
    if (hideFrame.current !== null) {
      cancelAnimationFrame(hideFrame.current);
      hideFrame.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancelHide();
    const el = tipRef.current;
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    labelRef.current = null;
  }, [cancelHide]);

  useEffect(() => cancelHide, [cancelHide]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const el = tipRef.current;
      if (!el) return;
      const target = event.target;
      const named =
        target instanceof Element
          ? target.closest(`[${MAP_TOOLTIP_ATTR}]`)
          : null;
      const label = named?.getAttribute(MAP_TOOLTIP_ATTR) ?? null;
      if (label === null) {
        // One frame later, so a neighbour's pointermove can cancel and skip the gap.
        if (hideFrame.current === null) {
          hideFrame.current = requestAnimationFrame(() => {
            hideFrame.current = null;
            hide();
          });
        }
        return;
      }
      cancelHide();
      if (labelRef.current !== label) {
        el.textContent = label;
        labelRef.current = label;
      }
      // Offset so the label sits just below and to the right of the pointer.
      el.style.transform = `translate(${String(event.clientX + 12)}px, ${String(event.clientY + 16)}px)`;
      el.hidden = false;
    },
    [cancelHide, hide],
  );

  const tooltip = (
    <div
      ref={tipRef}
      className="map-tooltip"
      data-testid="map-tooltip"
      role="tooltip"
      hidden
    />
  );

  return { tooltip, onPointerMove, onPointerLeave: hide };
}
