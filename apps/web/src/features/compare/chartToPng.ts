import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { SeriesChart } from "../evidence/SeriesChart";

export const EXCEL_CHART_WIDTH = 900;
export const EXCEL_CHART_HEIGHT = 420;

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "visibility",
] as const;

const CHART_BACKGROUND = "#0b1a24";

export type ExcelChartSeries = {
  title: string;
  unit: string;
  observations: { year: number; value: number | null }[];
  trendLine: { year: number; value: number }[] | null;
};

/** Renders SeriesChart offscreen and returns a PNG as raw base64, or null if capture fails. */
export async function seriesChartToPng(
  series: ExcelChartSeries,
): Promise<string | null> {
  if (series.observations.length === 0) return null;
  if (typeof document === "undefined") return null;

  const host = document.createElement("div");
  host.className = "excel-chart-export";
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);

  let root: Root | undefined;
  try {
    root = createRoot(host);
    flushSync(() => {
      root?.render(
        createElement(SeriesChart, {
          title: series.title,
          unit: series.unit,
          observations: series.observations,
          trendLine: series.trendLine,
          width: EXCEL_CHART_WIDTH,
          height: EXCEL_CHART_HEIGHT,
          testId: "excel-chart-export",
        }),
      );
    });
    const svg = await waitForChartSvg(host);
    if (svg === null) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(svg, clone);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    const width = svgSize(svg, "width", EXCEL_CHART_WIDTH);
    const height = svgSize(svg, "height", EXCEL_CHART_HEIGHT);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("viewBox")) {
      clone.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
    }
    const xml = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    return await svgDataUrlToPng(url, width, height);
  } catch {
    return null;
  } finally {
    root?.unmount();
    host.remove();
  }
}

async function waitForChartSvg(
  host: HTMLElement,
  timeoutMs = 4000,
): Promise<SVGSVGElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const svg = pickChartSvg(host);
    if (svg !== null) {
      await nextFrame();
      return pickChartSvg(host) ?? svg;
    }
    await nextFrame();
  }
  return pickChartSvg(host);
}

function pickChartSvg(host: HTMLElement): SVGSVGElement | null {
  const svgs = [...host.querySelectorAll("svg")].filter(
    (node): node is SVGSVGElement => node instanceof SVGSVGElement,
  );
  if (svgs.length === 0) return null;
  // Recharts also emits tiny 14px surfaces (legend/icons); take the largest plot.
  const candidate = svgs.reduce((best, node) =>
    svgSize(node, "width", 0) * svgSize(node, "height", 0) >
    svgSize(best, "width", 0) * svgSize(best, "height", 0)
      ? node
      : best,
  );
  const width = svgSize(candidate, "width", 0);
  const height = svgSize(candidate, "height", 0);
  return width >= 200 && height >= 100 ? candidate : null;
}

function svgSize(
  svg: SVGSVGElement,
  dim: "width" | "height",
  fallback: number,
): number {
  const client = dim === "width" ? svg.clientWidth : svg.clientHeight;
  if (client >= 200) return client;
  const raw = Number(svg.getAttribute(dim));
  if (Number.isFinite(raw) && raw >= 200) return raw;
  return fallback;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function inlineComputedStyles(source: Element, target: Element): void {
  const style = getComputedStyle(source);
  for (const prop of STYLE_PROPS) {
    const value = style.getPropertyValue(prop);
    if (value !== "") target.setAttribute(prop, value);
  }
  const srcKids = source.children;
  const dstKids = target.children;
  const n = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < n; i += 1) {
    const src = srcKids[i];
    const dst = dstKids[i];
    if (src !== undefined && dst !== undefined) inlineComputedStyles(src, dst);
  }
}

function svgDataUrlToPng(
  url: string,
  width: number,
  height: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        resolve(null);
        return;
      }
      ctx.fillStyle = CHART_BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const comma = dataUrl.indexOf(",");
      resolve(comma === -1 ? null : dataUrl.slice(comma + 1));
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = url;
  });
}
