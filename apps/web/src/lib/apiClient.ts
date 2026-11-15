// Shared HTTP client for the app's own API (compare, regions). Errors carry the API's ErrorResponse.
import type { ErrorResponse } from "../../../../packages/contracts/src/index";

import { t } from "../i18n";

// The web app only talks to its own API under /api/v1, never to NASA directly (brief §03).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

/** Failed API call. `body` is the API's ErrorResponse when the server sent one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ErrorResponse | null;

  constructor(status: number, body: ErrorResponse | null) {
    // 500/502 must not carry the API message on Error.message (UI-ERR).
    const hideBody = status === 500 || status === 502;
    super(
      hideBody
        ? `HTTP ${String(status)}`
        : (body?.error.message ?? `HTTP ${String(status)}`),
    );
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }

  /** The API decides whether a retry makes sense; without an error body a retry is offered. */
  get retryable(): boolean {
    return this.body?.error.retryable ?? true;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "retryable" in error
  );
}

export async function requestJson<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(
      response.status,
      isErrorResponse(body) ? body : null,
    );
  }
  return (await response.json()) as T;
}

/** User-facing API error text. 500 and 502 never show message or details from the body. */
export function apiUserMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiRequestError &&
    (error.status === 500 || error.status === 502)
  ) {
    return t("error.server");
  }
  return fallback;
}
