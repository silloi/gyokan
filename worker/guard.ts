/**
 * 公開デモの守り（費用の暴走と悪用を防ぐ）。
 *
 * - 同じ人（IP）からの呼び出しを制限する: ページの取得（Browser Rendering）と、Claude での生成をそれぞれ1分あたりの回数で
 *   （Workers の Rate Limiting。設定は wrangler.jsonc の ratelimits）
 * - Claude での生成の回数に、1日の上限を設ける（全体で。KV で数える。DAILY_GENERATIONS、"0" で生成を止める）
 *
 * fixture・取り込んだ補足・キャッシュから返すときは数えない（費用がかからないため）。
 * 数え方は厳密ではない（KV は結果整合なので、同時に来ると少し超えることがある）。上限は余裕をもって決める。
 */
import { HttpError } from "./http.ts";

function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

export async function limitPerClient(
  limiter: RateLimit | undefined,
  request: Request,
  what: string,
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: clientKey(request) });
  if (!success)
    throw new HttpError(
      429,
      "rate_limited",
      `${what}が続いています。1分ほど待ってから試してください`,
    );
}

const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

/** 日本時間の日付（上限は日本時間の0時に戻る） */
function today(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dailyLimit(env: Env): number {
  const n = Number(env.DAILY_GENERATIONS);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

/** Claude で生成する前に呼ぶ。上限に達していたら 503 */
export async function reserveGeneration(env: Env): Promise<void> {
  const limit = dailyLimit(env);
  if (limit === 0)
    throw new HttpError(
      503,
      "generation_off",
      "いまは新しいページの補足を作っていません（デモページと、補足を用意したページは読めます）",
    );
  if (!env.CACHE) return;
  const key = `budget:${today()}`;
  const used = Number((await env.CACHE.get(key)) ?? 0);
  if (used >= limit)
    throw new HttpError(
      503,
      "daily_limit",
      "今日、新しいページの補足を作れる回数を使い切りました。明日もう一度試してください（デモページと、補足を用意したページは読めます）",
    );
  await env.CACHE.put(key, String(used + 1), { expirationTtl: DAY_TTL_SECONDS });
}
