import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

function CloseIcon() {
  return (
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
  );
}

type ModalSize = "default" | "wide";

type ModalProps = {
  open: boolean;
  /** id of the title element, referenced by aria-labelledby. */
  titleId: string;
  /** Accessible name of the close button. */
  closeLabel: string;
  onClose: () => void;
  /** Element that receives focus when the dialog closes (falls back to the previously focused node). */
  restoreFocusTo?: RefObject<HTMLElement | null>;
  /** Visual size only; the primitive stays free of feature logic. */
  size?: ModalSize;
  children: ReactNode;
};

// UI primitive: no data logic. Overlay dialog with Esc, backdrop click, focus trap and
// focus restore. The caller owns open state and the title.
export function Modal({
  open,
  titleId,
  closeLabel,
  onClose,
  restoreFocusTo,
  size = "default",
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    const restoreNode = restoreFocusTo?.current ?? null;
    dialog?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || dialog === null) return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (restoreNode !== null) {
        restoreNode.focus();
      } else if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open, onClose, restoreFocusTo]);

  if (!open) return null;

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div
      className="td-modal-overlay"
      onClick={onBackdropClick}
      data-testid="modal-overlay"
    >
      <div
        ref={dialogRef}
        className={size === "wide" ? "td-modal td-modal--wide" : "td-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="modal-dialog"
      >
        <button
          type="button"
          className="td-modal__close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
