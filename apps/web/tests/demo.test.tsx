import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppProviders } from "../src/app/providers";
import { Root } from "../src/app/Root";
import { HOW_TO_SEEN_KEY } from "../src/features/howto/HowToModal";
import { t, tf } from "../src/i18n";

function renderRoot() {
  return render(
    <AppProviders>
      <Root />
    </AppProviders>,
  );
}

describe("/demo presentation page (E-84)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(HOW_TO_SEEN_KEY);
    window.history.pushState({}, "", "/demo");
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    window.localStorage.setItem(HOW_TO_SEEN_KEY, "1");
  });

  it("shows five slides and a link back to the app, without the how-to dialog", () => {
    renderRoot();

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(5);
    for (const n of [1, 2, 3, 4, 5]) {
      const img = screen.getByRole("img", {
        name: tf("demo.slideAlt", { n: String(n) }),
      });
      expect(img.getAttribute("src")).toBe(`/demo/slide-${String(n)}.jpg`);
      expect(img.getAttribute("width")).toBe("1919");
      expect(img.getAttribute("height")).toBe("1080");
      expect(img.getAttribute("loading")).toBe(n === 1 ? "eager" : "lazy");
    }

    const link = screen.getByRole("link", { name: t("demo.backToApp") });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toBe("Go to the web app");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("howTo.button") }),
    ).toBeNull();
  });

  it("also opens under a trailing slash", () => {
    window.history.pushState({}, "", "/demo/");
    renderRoot();
    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(
      screen.getByRole("link", { name: t("demo.backToApp") }),
    ).toBeDefined();
  });
});
