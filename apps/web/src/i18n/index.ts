import { en, type MessageKey } from "./en";

export type { MessageKey };

// English is the default UI language (brief, "Verbindliche Produktentscheidungen").
// de.ts is prepared but not switchable yet; locale selection is out of scope for A4.
export function t(key: MessageKey): string {
  return en[key];
}

/** Message with named placeholders, e.g. "Calculate for {name}" (UI-DESIGN-7). */
export function tf(key: MessageKey, values: Record<string, string>): string {
  return en[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? (values[name] ?? match) : match,
  );
}
