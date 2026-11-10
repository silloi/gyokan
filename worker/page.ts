/**
 * /api/page?url=... : ページを取得して、サニタイズした HTML を返す。
 *
 * 1. Browser Rendering（ヘッドレス Chrome）で JavaScript 実行後の HTML を取る
 * 2. Browser Rendering が使えない・失敗したときは、ふつうの fetch に切り替える（JS で描くページは崩れることがある）
 * 取得したページは保存しない（SPEC 8章）。
 *
 * 公的な性格のサイトは .go.jp / .lg.jp に限らない（JLPT、国際交流協会など）ので、既定ではどの公開サイトも読める。
 * localhost やプライベートネットワークのアドレスだけは読まない（ALLOW_PRIVATE_HOSTS=1 のときだけ許可。ローカル開発用）。
 */
import puppeteer, { type Browser } from "@cloudflare/puppeteer";
import type { PageResponse } from "../shared/types.ts";
import { limitPerClient } from "./guard.ts";
import { HttpError, json } from "./http.ts";
import { isAllowedHost, isPrivateHost } from "./hosts.ts";
import { sanitizeHtml } from "./sanitize.ts";

const NAV_TIMEOUT_MS = 25_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
/**
 * 取得に使う User-Agent。ブラウザには偽装せず、行間のリーダーであると名乗る。
 * （ヘッドレス Chrome の既定の UA「HeadlessChrome」は、一部の公的サイトの WAF で拒否される）
 */
const USER_AGENT = "Mozilla/5.0 (compatible; GyokanReader/0.1)";

interface Fetched {
  html: string;
  finalUrl: string;
  title: string;
}

export function parseTarget(raw: string | null, env: Env, selfHost: string): URL {
  if (!raw) throw new HttpError(400, "missing_url", "url を指定してください");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_url", "URL の形が正しくありません");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new HttpError(400, "invalid_url", "http または https の URL だけ読めます");
  }
  if (target.username || target.password) {
    throw new HttpError(400, "invalid_url", "ログイン情報を含む URL は読めません");
  }
  // 自分自身（同梱のデモページ）はいつでも読める
  if (target.hostname.toLowerCase() === selfHost.toLowerCase()) return target;
  if (isPrivateHost(target.hostname) && env.ALLOW_PRIVATE_HOSTS !== "1") {
    throw new HttpError(
      403,
      "host_not_allowed",
      "ローカルやプライベートネットワークのアドレスは読めません",
    );
  }
  if (!isAllowedHost(target.hostname, env.ALLOWED_HOSTS)) {
    throw new HttpError(
      403,
      "host_not_allowed",
      `このサイト（${target.hostname}）は、いまの設定では読めません`,
    );
  }
  return target;
}

async function openBrowser(env: Env): Promise<Browser> {
  // 空いているセッションがあれば使い回す（起動時間と Browser Rendering の利用枠の節約）
  try {
    const sessions = await puppeteer.sessions(env.BROWSER);
    const idle = sessions.find((s) => !s.connectionId);
    if (idle) return await puppeteer.connect(env.BROWSER, idle.sessionId);
  } catch {
    // セッション一覧が取れない環境では、新しく起動する
  }
  return await puppeteer.launch(env.BROWSER, { keep_alive: 60_000 });
}

async function renderWithBrowser(env: Env, target: URL): Promise<Fetched> {
  const browser = await openBrowser(env);
  try {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en;q=0.5" });
      // ブラウザの言語が日本語でないと、英語の機械翻訳ページへ自動で転送する自治体サイトがある（例: 新宿区）。
      // 読みたいのは日本語の原文なので、日本語のブラウザとして開く
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "language", { get: () => "ja-JP" });
        Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja"] });
      });
      await page.emulateTimezone("Asia/Tokyo").catch(() => undefined);
      await page.setViewport({ width: 1280, height: 900 });
      const response = await page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      const status = response?.status() ?? 0;
      // ヘッドレスブラウザだけを拒むサイトがある（入管の CloudFront は本番の Browser Rendering に 403 を返す。
      // 通常の fetch では 200）。HttpError にせず投げて、呼び出し元で通常の取得に切り替える。
      // 本当に無いページ（404 など）は、通常の取得でも同じ状態が返るので、そこで HttpError になる
      if (status >= 400) throw new Error(`ページが HTTP ${status} を返しました`);
      // JavaScript で本文を描くページのため、通信が落ち着くまで少し待つ（待ちすぎない）
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(() => undefined);
      return { html: await page.content(), finalUrl: page.url(), title: await page.title() };
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    // close せずに切断すると、セッションが keep_alive の間残り、次のリクエストで使い回せる
    await browser.disconnect();
  }
}

function charsetOf(contentType: string | null, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = new TextDecoder("latin1").decode(head.slice(0, 4096));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
  return (fromMeta ?? "utf-8").toLowerCase();
}

async function fetchDirect(target: URL, warnings: string[]): Promise<Fetched> {
  const res = await fetch(target.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ja,en;q=0.5",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok)
    throw new HttpError(502, "upstream_status", `ページが HTTP ${res.status} を返しました`);
  const type = res.headers.get("content-type") ?? "";
  if (!/html/i.test(type))
    throw new HttpError(415, "not_html", `HTML ではないファイルです（${type || "種類不明"}）`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_HTML_BYTES)
    throw new HttpError(413, "too_large", "ページが大きすぎます");
  const charset = charsetOf(type, buf);
  let html: string;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    warnings.push(
      `文字コード ${charset} を読めないため UTF-8 として読みました（文字化けの可能性）`,
    );
    html = new TextDecoder("utf-8").decode(buf);
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  return { html, finalUrl: res.url || target.toString(), title };
}

export async function handlePage(request: Request, env: Env): Promise<Response> {
  const self = new URL(request.url);
  const target = parseTarget(self.searchParams.get("url"), env, self.hostname);
  await limitPerClient(env.PAGE_LIMITER, request, "ページの取得");
  const warnings: string[] = [];

  let fetched: Fetched;
  let via: PageResponse["fetchedVia"] = "browser-rendering";
  try {
    fetched = await renderWithBrowser(env, target);
  } catch (e) {
    if (e instanceof HttpError) throw e; // ページ自体のエラー（404 など）はそのまま返す
    const brMessage = (e as Error).message.split("\n")[0];
    console.warn(`Browser Rendering failed: ${(e as Error).message}`);
    warnings.push(
      `Browser Rendering で取得できなかったため、通常の取得に切り替えました（${brMessage}）`,
    );
    via = "fetch";
    try {
      fetched = await fetchDirect(target, warnings);
    } catch (e2) {
      if (e2 instanceof HttpError) throw e2;
      throw new HttpError(
        502,
        "fetch_failed",
        `ページを取得できませんでした（Browser Rendering: ${brMessage} ／ 通常の取得: ${(e2 as Error).message.split("\n")[0]}）`,
      );
    }
  }

  // リダイレクト先が対象外のサイトなら返さない
  const final = new URL(fetched.finalUrl);
  parseTarget(final.toString(), env, self.hostname);

  const html = await sanitizeHtml(fetched.html, final.toString());
  return json<PageResponse>({
    requestedUrl: target.toString(),
    finalUrl: final.toString(),
    title: fetched.title,
    html,
    fetchedVia: via,
    warnings,
  });
}
