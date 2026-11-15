import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchRegionSearch } from "../region/regionApi";

/** The API accepts 2–100 characters (E-52b); shorter input shows search.minChars instead. */
export const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_CHARS = 100;
const DEBOUNCE_MS = 200;

/** Search hits for `input`, requested 200 ms after the last keystroke. */
export function useRegionSearch(input: string) {
  const query = input.trim().slice(0, SEARCH_MAX_CHARS);
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);
  const enabled = debounced.length >= SEARCH_MIN_CHARS;
  const result = useQuery({
    queryKey: ["regionSearch", debounced],
    queryFn: ({ signal }) => fetchRegionSearch(debounced, signal),
    enabled,
    // Borders and names do not change while the app runs.
    staleTime: Infinity,
  });
  return {
    tooShort: query.length < SEARCH_MIN_CHARS,
    // While typing, the last hits stay hidden until the debounced request answers.
    pending: query !== debounced || (enabled && result.isPending),
    result,
  };
}
