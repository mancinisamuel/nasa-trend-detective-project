import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportActions } from "../src/features/compare/ExportActions";
import type { ExportPayload } from "../src/features/compare/buildExport";
import {
  exportFilename,
  exportWorkbookFilename,
} from "../src/features/compare/buildExport";
import { t } from "../src/i18n";

const payload: ExportPayload = {
  locationLabel: "Vienna",
  latitude: 48.21,
  longitude: 16.37,
  startYear: 1981,
  endYear: 2025,
  variableId: "precipitation",
  unit: "mm/year",
  annualValues: [{ year: 1981, value: 621.91 }],
  slopePerDecade: 29.0137,
  ci95Low: 15.1937,
  ci95High: 42.8338,
  pValue: 0.00003875,
  analysisVersion: "annual-ols-hac-v2",
  source: "NASA POWER",
  retrievedAt: "2026-11-14T16:38:20.066249Z",
};

describe("export menu (UI-XLSX)", () => {
  it("opens an accessible menu with Excel, CSV and JSON, and closes on Escape", () => {
    const download = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:test",
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(download);

    render(
      <ExportActions
        payload={payload}
        buildExcelInput={() => {
          throw new Error("excel input should not be built for this test");
        }}
      />,
    );

    const button = screen.getByTestId("compare-export-button");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("compare-export-menu")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByTestId("compare-export-menu");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(screen.getByTestId("compare-export-excel").textContent).toBe(
      t("export.excel"),
    );
    expect(screen.getByTestId("compare-export-csv").textContent).toBe(
      t("export.csv"),
    );
    expect(screen.getByTestId("compare-export-json").textContent).toBe(
      t("export.json"),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("compare-export-menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("compare-export-csv"));
    expect(screen.queryByTestId("compare-export-menu")).toBeNull();
    expect(download).toHaveBeenCalled();

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("names the workbook without a variable slug", () => {
    expect(exportWorkbookFilename("Vienna", 1981, 2025)).toBe(
      "trend-detective_Vienna_1981-2025.xlsx",
    );
    expect(exportFilename(payload, "xlsx")).toBe(
      "trend-detective_Vienna_precipitation_1981-2025.xlsx",
    );
  });
});
