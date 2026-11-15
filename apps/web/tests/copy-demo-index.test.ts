import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyDemoIndexHtml } from "../vite.config";

describe("copyDemoIndexHtml (E-86)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("copies dist/index.html to dist/demo/index.html", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "td-demo-dist-"));
    dirs.push(outDir);
    writeFileSync(
      path.join(outDir, "index.html"),
      "<!doctype html><title>TD</title>",
    );

    copyDemoIndexHtml(outDir);

    expect(readFileSync(path.join(outDir, "demo", "index.html"), "utf8")).toBe(
      "<!doctype html><title>TD</title>",
    );
  });
});
