/**
 * POST /api/annotate {page, level} : 1レベル分の補足を返す。
 *
 * 探す順番: 同梱の fixture（デモページ）→ 取り込み済みの補足（KV）→ KV キャッシュ → Claude API で生成
 * - 取り込み済みの補足: Claude Code のセッションや人が作った補足を scripts/import-notes.ts で入れたもの
 * - キャッシュのキーは本文のハッシュ＋プロンプトの版＋モデル。補足データだけを短期間保存する（SPEC 8章）
 */
import Anthropic from "@anthropic-ai/sdk";
import { generateNotes, GenerationError, type Effort } from "../shared/generate.ts";
import { pageHash } from "../shared/hash.ts";
import { PROMPT_VERSION } from "../shared/prompts.ts";
import type { AnnotateResponse, GeneratorInfo, Level, Note, PageText } from "../shared/types.ts";
import { findFixture } from "./fixtures.ts";
import { HttpError, json } from "./http.ts";

const MAX_SENTENCES = 800;
const MAX_TOTAL_CHARS = 60_000;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const IMPORTED_TTL_SECONDS = 30 * 24 * 60 * 60;
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

interface CachedNotes {
  notes: Note[];
  generator: GeneratorInfo;
}

function parseBody(body: unknown): { page: PageText; level: Level } {
  const b = body as { page?: Partial<PageText>; level?: unknown };
  const level = b?.level;
  if (level !== 1 && level !== 2 && level !== 3 && level !== 4)
    throw new HttpError(400, "invalid_level", "level は 1〜4 です");
  const sentences = b.page?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0)
    throw new HttpError(400, "invalid_page", "本文（sentences）がありません");
  if (sentences.length > MAX_SENTENCES)
    throw new HttpError(413, "too_large", `文が多すぎます（${MAX_SENTENCES} 文まで）`);
  let total = 0;
  for (const s of sentences) {
    if (
      typeof s?.id !== "string" ||
      typeof s?.blockId !== "string" ||
      typeof s?.text !== "string"
    ) {
      throw new HttpError(400, "invalid_page", "sentences の形が正しくありません");
    }
    total += s.text.length;
  }
  if (total > MAX_TOTAL_CHARS)
    throw new HttpError(413, "too_large", `本文が長すぎます（${MAX_TOTAL_CHARS} 字まで）`);
  const title = typeof b.page?.title === "string" ? b.page.title.slice(0, 300) : "";
  const url = typeof b.page?.url === "string" ? b.page.url.slice(0, 2000) : undefined;
  return { page: { title, url, sentences }, level };
}

export async function handleAnnotate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST")
    throw new HttpError(405, "method_not_allowed", "POST で呼んでください");
  const { page, level } = parseBody(await request.json().catch(() => null));
  const hash = await pageHash(page.sentences);
  const respond = (source: AnnotateResponse["source"], notes: Note[], generator?: GeneratorInfo) =>
    json<AnnotateResponse>({
      level,
      pageHash: hash,
      source,
      notes: notes.filter((n) => n.level === level),
      generator,
    });

  const fixture = findFixture(hash);
  if (fixture) return respond("fixture", fixture.notes, fixture.generator);

  const imported = env.CACHE
    ? await env.CACHE.get<CachedNotes>(importedKey(hash, level), "json")
    : null;
  if (imported) return respond("imported", imported.notes, imported.generator);

  const model = env.CLAUDE_MODEL || "claude-opus-5-5";
  const key = `notes:${PROMPT_VERSION}:${model}:${hash}:L${level}`;
  // 貼り付けた文章（URL が無い）は個人情報を含むことがあるので、キャッシュに読み書きしない
  const cacheable = Boolean(env.CACHE && page.url);
  const cached = cacheable ? await env.CACHE.get<CachedNotes>(key, "json") : null;
  if (cached) return respond("cache", cached.notes, cached.generator);

  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(
      503,
      "claude_unavailable",
      "Claude API キーが設定されていないため、このページの補足はまだ作れません（デモページと、補足を取り込んだページだけ表示できます）",
    );
  }

  const effort = EFFORTS.includes(env.CLAUDE_EFFORT as Effort)
    ? (env.CLAUDE_EFFORT as Effort)
    : "high";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const result = await generateNotes(client, page, level, { model, effort });
    console.log(
      JSON.stringify({
        event: "generated",
        hash,
        level,
        notes: result.notes.length,
        dropped: result.dropped.length,
        usage: result.usage,
      }),
    );
    if (cacheable) {
      const value: CachedNotes = { notes: result.notes, generator: result.generator };
      ctx.waitUntil(
        env.CACHE.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS }),
      );
    }
    return respond("claude", result.notes, result.generator);
  } catch (e) {
    if (e instanceof GenerationError) throw new HttpError(502, `generation_${e.code}`, e.message);
    if (e instanceof Anthropic.RateLimitError)
      throw new HttpError(
        429,
        "rate_limited",
        "混み合っています。少し待ってからもう一度試してください",
      );
    if (e instanceof Anthropic.AuthenticationError)
      throw new HttpError(503, "claude_auth", "Claude API キーが正しくありません");
    if (e instanceof Anthropic.APIError)
      throw new HttpError(502, "claude_error", `Claude API のエラー（${e.status ?? "?"}）`);
    throw e;
  }
}

function importedKey(hash: string, level: Level): string {
  return `imported:${hash}:L${level}`;
}

/**
 * POST /api/dev/import {pageHash, notes, generator} : 補足を KV に取り込む（開発用。DEV_TOOLS=1 のときだけ有効）。
 * 取り込むのは補足データだけで、ページの本文は受け取らない。
 */
export async function handleImport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST")
    throw new HttpError(405, "method_not_allowed", "POST で呼んでください");
  const body = (await request.json().catch(() => null)) as {
    pageHash?: unknown;
    notes?: unknown;
    generator?: GeneratorInfo;
  } | null;
  if (
    typeof body?.pageHash !== "string" ||
    !/^[0-9a-f]{24}$/.test(body.pageHash) ||
    !Array.isArray(body.notes)
  ) {
    throw new HttpError(400, "invalid_body", "pageHash と notes が必要です");
  }
  const notes = body.notes as Note[];
  const generator: GeneratorInfo = body.generator ?? {
    kind: "manual",
    promptVersion: PROMPT_VERSION,
  };
  const counts: Record<string, number> = {};
  for (const level of [1, 2, 3, 4] as const) {
    const mine = notes.filter((n) => n?.level === level);
    counts[`L${level}`] = mine.length;
    const value: CachedNotes = { notes: mine, generator };
    await env.CACHE.put(importedKey(body.pageHash, level), JSON.stringify(value), {
      expirationTtl: IMPORTED_TTL_SECONDS,
    });
  }
  return json({ ok: true, pageHash: body.pageHash, counts });
}
