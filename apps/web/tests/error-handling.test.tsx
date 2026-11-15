import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/app/ErrorBoundary";
import { isAppHomePath } from "../src/app/NotFoundPage";
import { Root } from "../src/app/Root";
import { AppProviders } from "../src/app/providers";
import { t } from "../src/i18n";
import { ApiRequestError, apiUserMessage } from "../src/lib/apiClient";
import type { ErrorResponse } from "../src/features/compare/contract";

const LEAK_MESSAGE = "LEAK_SERVER_MESSAGE_XYZ";
const LEAK_DETAILS = "LEAK_SERVER_DETAILS_XYZ";

const leakBody: ErrorResponse = {
  error: {
    code: "INTERNAL_ERROR",
    message: LEAK_MESSAGE,
    request_id: "q",
    retryable: true,
    details: { info: LEAK_DETAILS },
  },
};

describe("unknown URL (UI-ERR)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("treats only the Vite base path as the start page", () => {
    expect(isAppHomePath("/", "/")).toBe(true);
    expect(isAppHomePath("", "/")).toBe(true);
    expect(isAppHomePath("/no-such-page", "/")).toBe(false);
    expect(isAppHomePath("/results", "/")).toBe(false);
  });

  it("shows the 404 page with a link home on an unknown path", () => {
    window.history.pushState({}, "", "/no-such-page");
    render(
      <AppProviders>
        <Root />
      </AppProviders>,
    );
    const page = screen.getByTestId("not-found");
    expect(page.textContent).toContain(t("error.notFound.title"));
    const home = screen.getByRole("link", { name: t("error.notFound.home") });
    expect(home.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("main")).toBeNull();
  });
});

describe("error boundary (UI-ERR)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a reload screen without the error message or stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "LEAK_RENDER_STACK_XYZ";

    function Boom(): never {
      throw new Error(`${secret}\n    at Boom (error-handling.test.tsx:1:1)`);
    }

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const screenBox = screen.getByTestId("error-boundary");
    expect(screenBox.textContent).toContain(t("error.boundary.title"));
    expect(
      screen.getByRole("button", { name: t("error.boundary.reload") }),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain("at Boom");
    expect(document.body.textContent).not.toContain("error-handling.test.tsx");
  });

  it("reloads the page from the Reload button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });

    function Boom(): never {
      throw new Error("hidden");
    }

    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(
        screen.getByRole("button", { name: t("error.boundary.reload") }),
      );
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("API 500/502 messages (UI-ERR)", () => {
  it("returns the neutral server text and never the body message or details", () => {
    for (const status of [500, 502]) {
      const error = new ApiRequestError(status, leakBody);
      const text = apiUserMessage(error, t("compare.error"));
      expect(text).toBe(t("error.server"));
      expect(text).not.toContain(LEAK_MESSAGE);
      expect(text).not.toContain(LEAK_DETAILS);
      expect(error.message).not.toContain(LEAK_MESSAGE);
    }
  });

  it("keeps the fallback for other status codes", () => {
    const error = new ApiRequestError(503, leakBody);
    expect(apiUserMessage(error, t("compare.error"))).toBe(t("compare.error"));
  });
});
