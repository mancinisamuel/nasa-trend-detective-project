import type { ReactNode } from "react";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { t, type MessageKey } from "../../i18n";
import { extremePoints, HIGHLIGHT } from "./chartHighlights";

type ObservationPoint = {
  year: number;
  value: number | null;
};

type TrendPoint = {
  year: number;
  value: number;
};

type SeriesChartProps = {
  observations: readonly ObservationPoint[];
  trendLine?: readonly TrendPoint[] | null;
  title: string;
  subtitle?: string;
  /** Unit shown on the Y axis via unit.* keys, no conversion. */
  unit: string;
  testId?: string;
  /** Fixed plot size (Excel export). When set, ResponsiveContainer is skipped. */
  width?: number;
  height?: number;
};

const UNIT_KEYS: Partial<Record<string, MessageKey>> = {
  degC: "unit.degC",
  "mm/year": "unit.mm_year",
  "mm/day": "unit.mm_day",
  mm: "unit.mm",
  "%": "unit.percent",
  "m/s": "unit.m_s",
  days: "unit.days",
  "MJ/m^2": "unit.mj_m2",
};

function unitLabel(unit: string): string {
  const key = UNIT_KEYS[unit];
  return key === undefined ? unit : t(key);
}

type ChartRow = {
  year: number;
  observation: number | null;
  trend: number | null;
};

/** Year ticks every 5 years, plus the first and last year of the range. */
function yearTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  if (from % 5 !== 0) ticks.push(from);
  const first = Math.ceil(from / 5) * 5;
  for (let year = first; year <= to; year += 5) ticks.push(year);
  if (ticks[ticks.length - 1] !== to) ticks.push(to);
  return ticks;
}

/**
 * Display range around the delivered values: padded, snapped to a readable step, not forced
 * through 0.
 */
function yScale(
  rows: ChartRow[],
): { domain: [number, number]; ticks: number[] } | null {
  const nums = rows.flatMap((row) =>
    [row.observation, row.trend].filter(
      (value): value is number => typeof value === "number",
    ),
  );
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const pad = span === 0 ? 0.5 : span * 0.12;
  const raw = max + pad - (min - pad);
  const step = raw <= 2 ? 0.5 : raw <= 5 ? 1 : raw <= 10 ? 2 : 5;
  const start = Math.floor((min - pad) / step) * step;
  const end = Math.ceil((max + pad) / step) * step;
  const ticks: number[] = [];
  const steps = Math.round((end - start) / step);
  for (let i = 0; i <= steps; i += 1) {
    ticks.push(Number((start + i * step).toFixed(2)));
  }
  return { domain: [ticks[0] ?? start, ticks[ticks.length - 1] ?? end], ticks };
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Annual observations and the API trend line for one location (UI-CHART). Values come from the
 * response; the frontend does not fit or interpolate.
 */
export function SeriesChart({
  observations,
  trendLine,
  title,
  subtitle,
  unit,
  testId = "series-chart",
  width,
  height,
}: SeriesChartProps) {
  if (observations.length === 0) return null;

  const trendData = (trendLine ?? []).map((point) => ({
    year: point.year,
    trend: point.value,
  }));
  const showTrend = trendData.length > 0;
  const values = new Map(
    observations.map((entry) => [entry.year, entry.value]),
  );
  const years = [
    ...new Set([...values.keys(), ...trendData.map((point) => point.year)]),
  ].sort((a, b) => a - b);
  // One row per year: observation is null only when the API sent null (or the year is
  // trend-only). The trend series uses its own data array so filler nulls cannot break it.
  const trendByYear = new Map(
    trendData.map((point) => [point.year, point.trend]),
  );
  const data: ChartRow[] = years.map((year) => ({
    year,
    observation: values.has(year) ? (values.get(year) ?? null) : null,
    trend: trendByYear.get(year) ?? null,
  }));
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  if (firstYear === undefined || lastYear === undefined) return null;
  const unitText = unitLabel(unit);
  const scale = yScale(data);
  // UI-DESIGN-10: highest and lowest delivered value marked with a dot and a small label.
  const extremes = extremePoints(observations);

  return (
    <figure className="series-chart" data-testid={testId}>
      <figcaption className="series-chart__caption">
        <span className="series-chart__title">{title}</span>
        {subtitle !== undefined && (
          <span className="series-chart__subtitle">{subtitle}</span>
        )}
      </figcaption>
      <div
        className="series-chart__plot"
        style={
          width !== undefined && height !== undefined
            ? { width, height, minHeight: 0 }
            : undefined
        }
      >
        <PlotFrame width={width} height={height} data={data}>
          <CartesianGrid stroke="rgba(244, 247, 248, 0.16)" vertical={false} />
          <XAxis
            dataKey="year"
            type="number"
            domain={[firstYear, lastYear]}
            ticks={yearTicks(firstYear, lastYear)}
            interval={0}
            allowDecimals={false}
            tick={{ fill: "#c8d2d6", fontSize: 12 }}
            tickMargin={8}
            stroke="rgba(244, 247, 248, 0.35)"
          />
          <YAxis
            width={72}
            domain={scale === null ? ["auto", "auto"] : scale.domain}
            ticks={scale?.ticks}
            tickFormatter={formatTick}
            tick={{ fill: "#c8d2d6", fontSize: 12 }}
            tickMargin={8}
            stroke="rgba(244, 247, 248, 0.35)"
            label={{
              value: unitText,
              position: "top",
              offset: 16,
              style: { fill: "#e6eeee", fontSize: 13, fontWeight: 600 },
            }}
          />
          <Tooltip
            cursor={{ stroke: "rgba(244, 247, 248, 0.28)" }}
            contentStyle={{
              background: "#0b1a24",
              border: "1px solid rgba(244, 247, 248, 0.22)",
              borderRadius: 8,
              color: "#f4f7f8",
            }}
            labelFormatter={(year) =>
              typeof year === "number" ? String(year) : ""
            }
            formatter={(value, name) => [
              typeof value === "number"
                ? `${value.toFixed(2)} ${unitText}`
                : "",
              name,
            ]}
          />
          <Legend
            position="bottom"
            wrapperStyle={{ color: "#c8d2d6", paddingTop: 8 }}
          />
          <Line
            type="linear"
            dataKey="observation"
            name={t("chart.legend.observations")}
            stroke="#5ec8d8"
            strokeWidth={2}
            dot={{ r: 3, fill: "#5ec8d8", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {showTrend && (
            <Line
              type="linear"
              data={trendData}
              dataKey="trend"
              name={t("chart.legend.trend")}
              stroke={HIGHLIGHT.trend}
              strokeWidth={3}
              strokeDasharray="8 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {extremes !== null &&
            (["max", "min"] as const).map((kind) => {
              const point = extremes[kind];
              return (
                <ReferenceDot
                  key={kind}
                  x={point.year}
                  y={point.value}
                  r={6}
                  fill={HIGHLIGHT[kind]}
                  stroke="#0b1a24"
                  strokeWidth={2}
                  label={{
                    value: `${point.value.toFixed(1)} (${String(point.year)})`,
                    position: kind === "max" ? "top" : "bottom",
                    fill: HIGHLIGHT[kind],
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                />
              );
            })}
        </PlotFrame>
      </div>
    </figure>
  );
}

function PlotFrame({
  width,
  height,
  data,
  children,
}: {
  width?: number;
  height?: number;
  data: ChartRow[];
  children: ReactNode;
}) {
  const chart = (
    <LineChart
      {...(width !== undefined && height !== undefined
        ? { width, height }
        : {})}
      data={data}
      // In the app the variable select, info button and export menu lie over the top corner
      // (UI-DESIGN-3), so the plot leaves room for them; fixed-size export images keep 28.
      margin={{
        top: width !== undefined && height !== undefined ? 28 : 64,
        right: 20,
        left: 12,
        bottom: 4,
      }}
    >
      {children}
    </LineChart>
  );
  if (width !== undefined && height !== undefined) return chart;
  return (
    <ResponsiveContainer width="100%" height="100%">
      {chart}
    </ResponsiveContainer>
  );
}
