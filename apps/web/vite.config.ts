import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type ResolvedConfig } from "vite";
import { defineConfig } from "vitest/config";

// The API (pnpm dev:api) listens on 127.0.0.1:8000. The web app only ever talks to
// /api/v1 on its own origin; Vite forwards those requests during development.
// start.sh sets TD_API_TARGET when API_PORT differs from 8000.
const DEFAULT_API_TARGET = "http://127.0.0.1:8000";

/** Copy the SPA shell into dist/demo so StaticFiles(html=True) can serve /demo/. */
export function copyDemoIndexHtml(outDir: string): void {
  const demoDir = path.join(outDir, "demo");
  mkdirSync(demoDir, { recursive: true });
  copyFileSync(
    path.join(outDir, "index.html"),
    path.join(demoDir, "index.html"),
  );
}

// public/demo/ holds the slide images, so Vite would otherwise treat /demo as a
// static directory instead of the SPA route. Rewrite only the exact path.
function rewriteDemoIndex(
  req: { url?: string },
  _res: unknown,
  next: () => void,
): void {
  const pathName = req.url?.split("?")[0];
  if (pathName === "/demo" || pathName === "/demo/") {
    req.url = "/index.html";
  }
  next();
}

function demoSpaFallback(): Plugin {
  let outDir = "";
  let isBuild = false;
  return {
    name: "demo-spa-fallback",
    configResolved(config: ResolvedConfig) {
      outDir = path.resolve(config.root, config.build.outDir);
      isBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use(rewriteDemoIndex);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteDemoIndex);
    },
    // E-86: production StaticFiles has no SPA fallback; emit dist/demo/index.html.
    writeBundle() {
      if (!isBuild) return;
      copyDemoIndexHtml(outDir);
    },
  };
}

export default defineConfig(({ mode }) => {
  const API_TARGET =
    loadEnv(mode, ".", "TD_")["TD_API_TARGET"] ?? DEFAULT_API_TARGET;
  return {
    plugins: [react(), demoSpaFallback()],
    // Absolute asset URLs so /demo/ can reuse the same index.html shell.
    base: "/",
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: API_TARGET, changeOrigin: false },
      },
    },
    preview: {
      host: "localhost",
      port: 4173,
      strictPort: true,
      proxy: {
        "/api": { target: API_TARGET, changeOrigin: false },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    },
  };
});
