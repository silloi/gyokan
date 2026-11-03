import type { ApiError } from "../shared/types.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json<T>(body: T, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return json<ApiError>({ error: e.code, message: e.message }, e.status);
  }
  console.error(e);
  return json<ApiError>({ error: "internal", message: "サーバーでエラーが起きました" }, 500);
}
