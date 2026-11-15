import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../src/app/providers";
import { AppLayout } from "../src/components/layout/AppLayout";
import {
  HOW_TO_POSTER_SRC,
  HOW_TO_SEEN_KEY,
  HOW_TO_VIDEO_MP4_SRC,
  HOW_TO_VIDEO_WEBM_SRC,
  HowToModal,
  HowToStep,
} from "../src/features/howto/HowToModal";
import { t } from "../src/i18n";

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function renderHowTo() {
  return render(<HowToModal />);
}

function renderShell() {
  return render(
    <AppLayout
      panelOpen={false}
      heading={<h1>Trend Detective</h1>}
      resultsOpen={false}
      onExpandGlobe={() => {}}
    >
      <div>stage</div>
    </AppLayout>,
    { wrapper: AppProviders },
  );
}

function stubMatchMedia(matchesReduce: boolean): void {
  window.matchMedia = (query: string) =>
    ({
      matches:
        matchesReduce &&
        query.includes("prefers-reduced-motion") &&
        query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

describe("how-to modal (E-79, E-80, E-81)", () => {
  afterEach(() => {
    window.localStorage.setItem(HOW_TO_SEEN_KEY, "1");
  });

  it("exports the video and poster paths as constants", () => {
    expect(HOW_TO_VIDEO_WEBM_SRC).toBe("/howto/how-to.webm");
    expect(HOW_TO_VIDEO_MP4_SRC).toBe("/howto/how-to.mp4");
    expect(HOW_TO_POSTER_SRC).toBe("/howto/how-to.jpg");
  });

  it("opens and closes from the How to button", () => {
    renderHowTo();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("howTo.button") }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      within(dialog).getByRole("heading", { name: t("howTo.title") }),
    ).toBeDefined();
    const video = dialog.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe("metadata");
    expect(video?.getAttribute("poster")).toBe(HOW_TO_POSTER_SRC);
    expect(video?.controls).toBe(false);
    expect(video?.getAttribute("aria-label")).toBe(t("howTo.title"));
    const sources = [...(video?.querySelectorAll("source") ?? [])];
    expect(sources).toHaveLength(2);
    expect(sources[0]?.getAttribute("src")).toBe(HOW_TO_VIDEO_WEBM_SRC);
    expect(sources[0]?.getAttribute("type")).toBe("video/webm");
    expect(sources[1]?.getAttribute("src")).toBe(HOW_TO_VIDEO_MP4_SRC);
    expect(sources[1]?.getAttribute("type")).toBe("video/mp4");
    expect(dialog.classList.contains("td-modal--wide")).toBe(true);
    expect(within(dialog).getByText(t("howTo.step1"))).toBeDefined();
    expect(within(dialog).getByText(t("howTo.step1Hint"))).toBeDefined();
    expect(within(dialog).getByText(t("howTo.step2"))).toBeDefined();
    expect(within(dialog).getByText(t("howTo.step2Hint"))).toBeDefined();
    expect(within(dialog).getByText(t("howTo.step3"))).toBeDefined();
    expect(within(dialog).getByText(t("howTo.step3Hint"))).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: t("howTo.close") }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the round button on the video's corner restarts it from the beginning (UI-DESIGN-15)", () => {
    renderHowTo();
    fireEvent.click(screen.getByRole("button", { name: t("howTo.button") }));
    const dialog = screen.getByRole("dialog");
    const video = dialog.querySelector("video");
    expect(video).not.toBeNull();
    if (video === null) return;
    const restart = within(dialog).getByRole("button", {
      name: t("howTo.restart"),
    });
    // It sits with the video in one player box (CSS puts it on the top right corner).
    expect(restart.parentElement).toBe(video.parentElement);
    expect(restart.parentElement?.classList.contains("how-to__player")).toBe(
      true,
    );
    expect(restart.getAttribute("title")).toBe(t("howTo.restart"));
    video.currentTime = 7;
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    fireEvent.click(restart);
    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not autoplay and shows controls when reduced motion is preferred", () => {
    stubMatchMedia(true);
    try {
      renderHowTo();
      fireEvent.click(screen.getByRole("button", { name: t("howTo.button") }));
      const video = screen.getByRole("dialog").querySelector("video");
      expect(video).not.toBeNull();
      expect(video?.autoplay).toBe(false);
      expect(video?.controls).toBe(true);
      expect(video?.getAttribute("poster")).toBe(HOW_TO_POSTER_SRC);
    } finally {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("closes on Escape and restores focus to the button", () => {
    renderHowTo();
    const button = screen.getByRole("button", { name: t("howTo.button") });
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes when the overlay is clicked, not when the dialog is clicked", () => {
    renderHowTo();
    fireEvent.click(screen.getByRole("button", { name: t("howTo.button") }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByTestId("modal-overlay"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("auto-opens only when the localStorage key is missing", () => {
    window.localStorage.removeItem(HOW_TO_SEEN_KEY);
    const first = renderHowTo();
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(window.localStorage.getItem(HOW_TO_SEEN_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: t("howTo.close") }));
    first.unmount();

    const second = renderHowTo();
    expect(screen.queryByRole("dialog")).toBeNull();
    second.unmount();

    window.localStorage.removeItem(HOW_TO_SEEN_KEY);
    renderHowTo();
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("keeps Tab inside the dialog", () => {
    renderHowTo();
    fireEvent.click(screen.getByRole("button", { name: t("howTo.button") }));
    const dialog = screen.getByRole("dialog");
    // Close and the video's restart button (UI-DESIGN-15) are the dialog's focus stops.
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining([t("howTo.close"), t("howTo.restart")]),
    );
    const first = buttons[0];
    const last = buttons.at(-1);
    if (first === undefined || last === undefined) return;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("places the How to button at the top right of the toolbar", () => {
    renderShell();
    const button = screen.getByRole("button", { name: t("howTo.button") });
    const toolbar = document.querySelector(".app-layout__toolbar");
    expect(toolbar?.contains(button)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a step hint only when the text is not empty", () => {
    const { rerender } = render(
      <ol>
        <HowToStep title="Title" hint="Hint line" />
      </ol>,
    );
    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.getByText("Hint line")).toBeDefined();
    expect(document.querySelector(".how-to__step-hint")).not.toBeNull();

    rerender(
      <ol>
        <HowToStep title="Title" hint="" />
      </ol>,
    );
    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.queryByText("Hint line")).toBeNull();
    expect(document.querySelector(".how-to__step-hint")).toBeNull();
  });
});
