import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../src/app/App";
import { AppProviders } from "../src/app/providers";
import { AppLayout } from "../src/components/layout/AppLayout";
import { Button } from "../src/components/ui/Button";
import { Select } from "../src/components/ui/Select";
import { StatusBanner } from "../src/components/ui/StatusBanner";
import { de } from "../src/i18n/de";
import { en } from "../src/i18n/en";

describe("app shell", () => {
  it("renders a main heading and a main landmark", () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
  });
});

describe("floating side panel (UI-DESIGN-5)", () => {
  function renderLayout(panelOpen: boolean) {
    render(
      <AppLayout
        panelOpen={panelOpen}
        heading="h"
        panelContent={
          <div className="app-layout__side" data-testid="side-panel">
            <section data-testid="place">place</section>
            <section data-testid="metrics">metrics</section>
          </div>
        }
        resultsOpen={false}
        onExpandGlobe={() => {}}
      >
        <div data-testid="globe">globe</div>
      </AppLayout>,
      { wrapper: AppProviders },
    );
  }

  it("shows place and results in one panel that lies over the card, not inside the stage", () => {
    renderLayout(true);
    const panels = screen.getAllByTestId("side-panel");
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel?.contains(screen.getByTestId("place"))).toBe(true);
    expect(panel?.contains(screen.getByTestId("metrics"))).toBe(true);
    const card = document.querySelector(".app-layout__card");
    const stage = document.querySelector(".app-layout__stage");
    expect(panel?.parentElement).toBe(card);
    expect(stage?.contains(panel ?? null)).toBe(false);
    // The globe keeps the whole stage; the panel only overlays it.
    expect(stage?.contains(screen.getByTestId("globe"))).toBe(true);
    expect(screen.getByTestId("app-layout").getAttribute("data-panel")).toBe(
      "open",
    );
  });

  it("renders no panel while closed", () => {
    renderLayout(false);
    expect(screen.queryByTestId("side-panel")).toBeNull();
    expect(screen.getByTestId("app-layout").getAttribute("data-panel")).toBe(
      "closed",
    );
  });
});

describe("i18n dictionaries", () => {
  it("de.ts provides exactly the keys of en.ts", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("ui primitives", () => {
  it("Button does not submit forms by default", () => {
    render(<Button>x</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("Select is reachable through its label", () => {
    render(
      <Select
        label="label"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    expect(screen.getByLabelText("label").tagName).toBe("SELECT");
  });

  it("StatusBanner announces errors as alert and other tones as status", () => {
    const { rerender } = render(<StatusBanner tone="error">e</StatusBanner>);
    expect(screen.getByRole("alert")).toBeDefined();
    rerender(<StatusBanner tone="warning">w</StatusBanner>);
    expect(screen.getByRole("status")).toBeDefined();
  });
});
