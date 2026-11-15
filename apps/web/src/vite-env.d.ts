/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base path of the Trend Detective API, e.g. "/api/v1". Never put secrets in VITE_ variables. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
