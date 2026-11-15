import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import { t } from "../../i18n";
import {
  buildExportCsv,
  buildExportJson,
  downloadBlob,
  downloadTextFile,
  EXCEL_MIME,
  exportFilename,
  exportWorkbookFilename,
  type ExportPayload,
} from "./buildExport";
import { buildExcelWorkbook, type ExcelReportInput } from "./buildExcelReport";
import { seriesChartToPng } from "./chartToPng";
import { renderExcelChartImages } from "./buildExcelReport";

type ExportActionsProps = {
  payload: ExportPayload;
  buildExcelInput: () => ExcelReportInput;
};

/** One Export control: Excel report of loaded data, plus CSV/JSON of the shown series. */
export function ExportActions({
  payload,
  buildExcelInput,
}: ExportActionsProps) {
  const buttonId = useId();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  function onJson() {
    closeMenu();
    downloadTextFile(
      exportFilename(payload, "json"),
      buildExportJson(payload),
      "application/json;charset=utf-8",
    );
  }

  function onCsv() {
    closeMenu();
    downloadTextFile(
      exportFilename(payload, "csv"),
      buildExportCsv(payload),
      "text/csv;charset=utf-8",
    );
  }

  async function onExcel() {
    closeMenu();
    if (busy) return;
    setError(false);
    setBusy(true);
    try {
      const input = buildExcelInput();
      const images = await renderExcelChartImages(input.series, (item) =>
        seriesChartToPng({
          title: item.title,
          unit: item.unit,
          observations: item.observations,
          trendLine: item.trendLine,
        }),
      );
      const exceljs = await import("exceljs");
      const workbook = buildExcelWorkbook(input, exceljs, images);
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        exportWorkbookFilename(
          input.locationLabel,
          input.startYear,
          input.endYear,
        ),
        new Blob([buffer], { type: EXCEL_MIME }),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compare-export" data-testid="compare-export">
      <p className="compare-export__label">{t("export.label")}</p>
      <div className="compare-export__dropdown" ref={rootRef}>
        <Button
          ref={buttonRef}
          id={buttonId}
          variant="secondary"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-busy={busy}
          disabled={busy}
          data-testid="compare-export-button"
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {busy ? t("export.busy") : t("export.button")}
        </Button>
        {open && (
          <ul
            id={menuId}
            className="compare-export__menu"
            role="menu"
            aria-labelledby={buttonId}
            aria-label={t("export.menu")}
            data-testid="compare-export-menu"
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="compare-export-excel"
                disabled={busy}
                onClick={() => {
                  void onExcel();
                }}
              >
                {t("export.excel")}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="compare-export-csv"
                onClick={onCsv}
              >
                {t("export.csv")}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="compare-export-json"
                onClick={onJson}
              >
                {t("export.json")}
              </button>
            </li>
          </ul>
        )}
      </div>
      {error && (
        <p className="compare-export__error" role="alert">
          {t("export.excel.error")}
        </p>
      )}
    </div>
  );
}
