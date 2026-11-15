import { useEffect, useId, useRef, useState } from "react";

import { Modal } from "../../components/ui/Modal";
import { t, type MessageKey } from "../../i18n";

export const HOW_TO_VIDEO_WEBM_SRC = "/howto/how-to.webm";
export const HOW_TO_VIDEO_MP4_SRC = "/howto/how-to.mp4";
export const HOW_TO_POSTER_SRC = "/howto/how-to.jpg";

export const HOW_TO_SEEN_KEY = "td.howto.seen";

const HOW_TO_STEPS = [
  { titleKey: "howTo.step1", hintKey: "howTo.step1Hint" },
  { titleKey: "howTo.step2", hintKey: "howTo.step2Hint" },
  { titleKey: "howTo.step3", hintKey: "howTo.step3Hint" },
] as const satisfies ReadonlyArray<{
  titleKey: MessageKey;
  hintKey: MessageKey;
}>;

export function hasSeenHowTo(): boolean {
  try {
    return window.localStorage.getItem(HOW_TO_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function markHowToSeen(): void {
  try {
    window.localStorage.setItem(HOW_TO_SEEN_KEY, "1");
  } catch {
    // Private mode or blocked storage must not break the dialog.
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(media.matches);
    };
    onChange();
    if (typeof media.addEventListener !== "function") {
      return;
    }
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  return reduced;
}

function HelpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9.6 9.4a2.4 2.4 0 1 1 2.9 2.3c-.7.3-1.1.8-1.1 1.6v.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="11.4" cy="16.6" r="1.05" fill="currentColor" />
    </svg>
  );
}

/** Circular arrow for the restart button over the demo video (UI-DESIGN-15). */
function RestartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4.5 3.5v3.7h3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One how-to step: CSS number badge, title, and an optional hint line. */
export function HowToStep({ title, hint }: { title: string; hint: string }) {
  return (
    <li className="how-to__step">
      <div className="how-to__step-copy">
        <span className="how-to__step-title">{title}</span>
        {hint !== "" ? <p className="how-to__step-hint">{hint}</p> : null}
      </div>
    </li>
  );
}

/**
 * How-to control (E-79–E-82): the "How to" button at the top right of the
 * toolbar and its modal. Opens once on the first visit (localStorage), then only
 * via the button. Wording from TD Texter. The demo video autoplays unless the
 * user prefers reduced motion, in which case the poster and playback controls
 * are shown.
 */
export function HowToModal() {
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(() => !hasSeenHowTo());
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (open) markHowToSeen();
  }, [open]);

  // UI-DESIGN-15: the looping video starts over at once instead of waiting for its end.
  function restart() {
    const video = videoRef.current;
    if (video === null) return;
    video.currentTime = 0;
    // Autoplay rules may refuse play(); the video then simply stays at its first frame.
    video.play().catch(() => undefined);
  }

  function close() {
    markHowToSeen();
    setOpen(false);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="app-layout__howto"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        <HelpIcon />
        {t("howTo.button")}
      </button>
      <Modal
        open={open}
        titleId={titleId}
        closeLabel={t("howTo.close")}
        restoreFocusTo={buttonRef}
        onClose={close}
        size="wide"
      >
        <h2 id={titleId} className="how-to__title">
          {t("howTo.title")}
        </h2>
        <div className="how-to__media">
          <div className="how-to__player">
            <video
              ref={videoRef}
              className="how-to__video"
              autoPlay={!reducedMotion}
              muted
              loop
              playsInline
              preload="metadata"
              poster={HOW_TO_POSTER_SRC}
              controls={reducedMotion}
              aria-label={t("howTo.title")}
            >
              <source src={HOW_TO_VIDEO_WEBM_SRC} type="video/webm" />
              <source src={HOW_TO_VIDEO_MP4_SRC} type="video/mp4" />
            </video>
            <button
              type="button"
              className="how-to__restart"
              aria-label={t("howTo.restart")}
              title={t("howTo.restart")}
              onClick={restart}
            >
              <RestartIcon />
            </button>
          </div>
        </div>
        <ol className="how-to__steps">
          {HOW_TO_STEPS.map((step) => (
            <HowToStep
              key={step.titleKey}
              title={t(step.titleKey)}
              hint={t(step.hintKey)}
            />
          ))}
        </ol>
      </Modal>
    </>
  );
}
