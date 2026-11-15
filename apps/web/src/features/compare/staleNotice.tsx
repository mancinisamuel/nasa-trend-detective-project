import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Toast } from "../../components/ui/Toast";
import { t } from "../../i18n";

type Report = (source: string, stale: boolean) => void;

const StaleNoticeContext = createContext<Report | null>(null);

/**
 * UI-DESIGN-4: the "may be out of date" hint as one toast at the bottom edge instead of a banner
 * at the chart and in the side panel. Chart and result card report their stale state; the toast
 * shows once each time the selection turns stale (whoever reports first), never twice at once, and
 * goes away when nothing is stale any more.
 */
export function StaleNoticeProvider({ children }: { children: ReactNode }) {
  const staleSources = useRef(new Set<string>());
  const occurrence = useRef(0);
  const [toastKey, setToastKey] = useState<number | null>(null);
  const report = useCallback<Report>((source, stale) => {
    const wasStale = staleSources.current.size > 0;
    if (stale) staleSources.current.add(source);
    else staleSources.current.delete(source);
    const isStale = staleSources.current.size > 0;
    if (isStale && !wasStale) {
      occurrence.current += 1;
      setToastKey(occurrence.current);
    } else if (!isStale && wasStale) {
      setToastKey(null);
    }
  }, []);
  const dismiss = useCallback(() => {
    setToastKey(null);
  }, []);
  return (
    <StaleNoticeContext.Provider value={report}>
      {children}
      {toastKey !== null && (
        <Toast
          key={toastKey}
          message={t("compare.stale")}
          closeLabel={t("toast.close")}
          onDismiss={dismiss}
        />
      )}
    </StaleNoticeContext.Provider>
  );
}

/** Reports whether this component's shown result is stale (no-op outside the provider). */
export function useStaleNotice(stale: boolean): void {
  const report = useContext(StaleNoticeContext);
  const source = useId();
  useEffect(() => {
    report?.(source, stale);
  }, [report, source, stale]);
  useEffect(
    () => () => {
      report?.(source, false);
    },
    [report, source],
  );
}
