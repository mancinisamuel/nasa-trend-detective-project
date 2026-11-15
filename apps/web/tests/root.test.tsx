import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppProviders } from "../src/app/providers";
import { Root } from "../src/app/Root";
import { t } from "../src/i18n";

function renderRoot(pathname: string) {
  window.history.pushState({}, "", pathname);
  return render(
    <AppProviders>
      <Root />
    </AppProviders>,
  );
}

describe("Root path choice (E-87)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the demo page on /demo and /demo/", () => {
    for (const path of ["/demo", "/demo/"]) {
      const { unmount } = renderRoot(path);
      const link = screen.getByRole("link", { name: t("demo.backToApp") });
      expect(link.getAttribute("href")).toBe("/");
      expect(link.textContent).toBe("Go to the web app");
      expect(screen.queryByTestId("not-found")).toBeNull();
      expect(
        screen.queryByRole("button", { name: t("howTo.button") }),
      ).toBeNull();
      unmount();
    }
  });

  it("renders the app on /", () => {
    renderRoot("/");
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(
      screen.queryByRole("link", { name: t("demo.backToApp") }),
    ).toBeNull();
  });

  it("renders the not-found page on an unknown path", () => {
    renderRoot("/xyz");
    expect(screen.getByTestId("not-found").textContent).toContain(
      t("error.notFound.title"),
    );
    expect(
      screen.getByRole("link", { name: t("error.notFound.home") }),
    ).toBeDefined();
    expect(
      screen.queryByRole("link", { name: t("demo.backToApp") }),
    ).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
  });
});
