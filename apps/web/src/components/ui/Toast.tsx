import { useEffect, useState } from "react";

/** How long a toast stays fully visible before it fades out (UI-DESIGN-4). */
export const TOAST_VISIBLE_MS = 3000;
/** Fade-out duration; matches --toast-fade in tokens.css. */
export const TOAST_FADE_MS = 300;

type ToastProps = {
  message: string;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** Called when the toast is closed by its X or has faded out. */
  onDismiss: () => void;
};

// UI primitive: no data logic. Slides in from the bottom edge, stays TOAST_VISIBLE_MS, then fades
// out; the X closes it at once. Mount it with a new key for each new occurrence.
export function Toast({ message, closeLabel, onDismiss }: ToastProps) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLeaving(true);
    }, TOAST_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDismiss, TOAST_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, onDismiss]);
  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      data-phase={leaving ? "leave" : "enter"}
      data-testid="toast"
    >
      <p className="toast__message">{message}</p>
      <button
        type="button"
        className="toast__close"
        aria-label={closeLabel}
        onClick={onDismiss}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
