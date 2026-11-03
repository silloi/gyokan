import type {
  AnnotateResponse,
  ApiError,
  Level,
  PageResponse,
  PageText,
} from "../../shared/types.ts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new ApiRequestError(0, "network", "サーバーにつながりません");
  }
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = body as ApiError | null;
    throw new ApiRequestError(
      res.status,
      err?.error ?? "unknown",
      err?.message ?? `エラーが起きました（${res.status}）`,
    );
  }
  return body as T;
}

export function fetchPage(url: string, signal?: AbortSignal): Promise<PageResponse> {
  return call<PageResponse>(`/api/page?url=${encodeURIComponent(url)}`, { signal });
}

export function fetchNotes(
  page: PageText,
  level: Level,
  signal?: AbortSignal,
): Promise<AnnotateResponse> {
  return call<AnnotateResponse>("/api/annotate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ page, level }),
    signal,
  });
}
