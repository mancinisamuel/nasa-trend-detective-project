import { useId, useState } from "react";

import { t } from "../../i18n";
import type {
  ExtremeMetric,
  ExtremeMetrics,
  Provenance,
} from "../compare/contract";
import {
  formatQuantity,
  RECORD_IDS,
  RECORD_LABEL,
  recordEntry,
  unitLabel,
} from "./metrics";

/** One-line capital label, or null when the method is not capital_point. */
export function capitalPointNote(
  provenance: Pick<Provenance, "spatial_method" | "capital_name">,
): string | null {
  if (provenance.spatial_method !== "capital_point") return null;
  const name = provenance.capital_name;
  if (name != null && name !== "") {
    return t("extremes.capitalNote").replaceAll("{name}", name);
  }
  return t("extremes.capitalNote.unnamed");
}

/** Record tiles (hottest / wettest / strongest hourly wind) from the extremes response. */
export function ExtremesRecords({
  metrics,
  provenance,
}: {
  metrics: ExtremeMetrics;
  provenance?: Pick<Provenance, "spatial_method" | "capital_name">;
}) {
  const caption =
    provenance === undefined ? null : capitalPointNote(provenance);
  return (
    <div className="extremes__records-block">
      {caption !== null && <CapitalPointCaption text={caption} />}
      <ul className="extremes__records" data-testid="extremes-records">
        {RECORD_IDS.map((id) => (
          <RecordTile
            key={id}
            label={t(RECORD_LABEL[id])}
            metric={metrics[id]}
          />
        ))}
      </ul>
    </div>
  );
}

/** Short capital line with the existing (i) button; tooltip on hover and keyboard focus. */
function CapitalPointCaption({ text }: { text: string }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const info = t("extremes.capitalInfo");
  return (
    <div className="extremes__capital" data-testid="extremes-capital-note">
      <span className="extremes__capital-label">{text}</span>
      <span className="extremes__capital-info">
        <button
          type="button"
          className="timeline__info"
          aria-label={info}
          aria-describedby={tooltipId}
          data-testid="extremes-capital-info"
          onMouseEnter={() => {
            setOpen(true);
          }}
          onMouseLeave={() => {
            setOpen(false);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
        >
          <span aria-hidden="true">i</span>
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className="extremes__capital-tooltip"
          data-testid="extremes-capital-tooltip"
          hidden={!open}
        >
          {info}
        </span>
      </span>
    </div>
  );
}

function RecordTile({
  label,
  metric,
}: {
  label: string;
  metric: ExtremeMetric;
}) {
  const record = recordEntry(metric.series);
  const unit = unitLabel(metric.unit);
  return (
    <li className="extremes__record" data-testid="extremes-record">
      <p className="extremes__record-label">{label}</p>
      {record === null || record.value === null ? (
        <p className="extremes__record-value">{t("extremes.record.noValue")}</p>
      ) : (
        <>
          <p className="extremes__record-value">
            {`${formatQuantity(record.value)} ${unit}`}
          </p>
          {record.date !== null && (
            <p className="extremes__record-date">{record.date}</p>
          )}
        </>
      )}
    </li>
  );
}
