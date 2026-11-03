/**
 * スクリプト用: HTML を読み込んで、ブラウザと同じ規則で文分割する（jsdom）。
 *
 * 読み込み元:
 * - ローカルの HTML ファイル（例: public/demo/kamome-tennyu.html）
 * - URL（--api を付けると、起動中の行間の /api/page 経由で Browser Rendering の結果を使う）
 */
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { pageHash } from "../../shared/hash.ts";
import { segmentDocument } from "../../shared/segment.ts";
import type { PageResponse, PageText } from "../../shared/types.ts";

export interface LoadedPage {
  page: PageText;
  hash: string;
  html: string;
}

export interface LoadOptions {
  /** 行間の API のオリジン（例: http://localhost:5173）。指定すると /api/page で取得する */
  api?: string;
  /** ファイルを読むときに、ページの URL として扱う値 */
  url?: string;
}

export async function loadPage(source: string, options: LoadOptions = {}): Promise<LoadedPage> {
  let html: string;
  let url = options.url;
  let title = "";
  if (/^https?:\/\//.test(source)) {
    if (options.api) {
      const res = await fetch(`${options.api}/api/page?url=${encodeURIComponent(source)}`);
      if (!res.ok) throw new Error(`/api/page が ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as PageResponse;
      html = body.html;
      url = body.finalUrl;
      title = body.title;
    } else {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`${source} が ${res.status}`);
      html = await res.text();
      url = res.url;
    }
  } else {
    html = await readFile(source, "utf8");
  }
  const dom = new JSDOM(html, url ? { url } : {});
  const seg = segmentDocument(dom.window.document);
  const page: PageText = {
    title: title || dom.window.document.title,
    url,
    sentences: seg.sentences,
  };
  return { page, hash: await pageHash(page.sentences), html };
}

/** 引数の簡単な解釈: --name value / --flag */
export function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string | true>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
