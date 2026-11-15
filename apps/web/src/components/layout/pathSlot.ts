import { createContext } from "react";

/**
 * Element in the map toolbar row (E-52d) that takes the globe path chip, so the path and the
 * collapsed search icon share one row top left. Null outside AppLayout: the chip then stays in
 * place.
 */
export const PathSlotContext = createContext<HTMLElement | null>(null);
