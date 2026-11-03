import { JSDOM } from "jsdom";
import { describe, expect, test } from "vite-plus/test";
import { findContentRoot, segmentDocument, wrapInSentence } from "./segment.ts";

const parse = (html: string) => new JSDOM(html).window.document;

const SAMPLE = `<!doctype html><html><head><title>t</title></head><body>
<header><p>サイトのヘッダーです。</p></header>
<nav><ul><li>メニュー1です。</li></ul></nav>
<main>
  <div class="breadcrumb">トップ &gt; 手続き</div>
  <h1>転入届</h1>
  <p>他の市区町村から引っ越してきたときは、
     転入届が必要です。<a href="#a">14日以内</a>に届け出てください。</p>
  <ul>
    <li>転出証明書<span class="sr-only">（PDF）</span></li>
    <li>本人確認書類（運転免許証など。）<ul><li>コピーは不可です。</li></ul></li>
  </ul>
  <table><tr><th>受付時間</th><td>平日 午前8時30分から<br>午後5時まで</td></tr></table>
  <script>document.write("x。")</script>
</main>
<footer><p>フッターです。</p></footer>
</body></html>`;

describe("segmentDocument", () => {
  test("本文の範囲から文を取り出し、ページの枠は除く", () => {
    const doc = parse(SAMPLE);
    const seg = segmentDocument(doc);
    expect(seg.root.localName).toBe("main");
    expect(seg.sentences.map((s) => s.text)).toEqual([
      "転入届",
      "他の市区町村から引っ越してきたときは、転入届が必要です。",
      "14日以内に届け出てください。",
      "転出証明書",
      "本人確認書類（運転免許証など。）",
      "コピーは不可です。",
      "受付時間",
      // <br> で折り返しているだけなので 1 文にまとめる
      "平日 午前8時30分から午後5時まで",
    ]);
    expect(seg.sentences.map((s) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
    ]);
  });

  test("原文のテキストは変わらない", () => {
    const doc = parse(SAMPLE);
    const before = doc.querySelector("main")!.textContent;
    segmentDocument(doc);
    expect(doc.querySelector("main")!.textContent).toBe(before);
  });

  test("要素をまたぐ文は複数の gk-s に分けて包む", () => {
    const doc = parse(SAMPLE);
    segmentDocument(doc);
    const parts = Array.from(doc.querySelectorAll('gk-s[data-s="s3"]'));
    expect(parts.map((p) => p.textContent)).toEqual(["14日以内", "に届け出てください。"]);
    expect(parts[0]!.parentElement!.localName).toBe("a");
  });

  test("ブロックの置き場所: 見出しは後ろ、それ以外は中。入れ子のリストは手前の文だけを包む", () => {
    const doc = parse(SAMPLE);
    const seg = segmentDocument(doc);
    const byFirst = new Map(
      seg.blocks.map((b) => [seg.sentences.find((s) => s.id === b.sentenceIds[0])!.text, b]),
    );
    expect(byFirst.get("転入届")).toMatchObject({ kind: "heading", placement: "after" });
    expect(byFirst.get("転出証明書")).toMatchObject({ kind: "list-item", placement: "inside" });
    const outer = byFirst.get("本人確認書類（運転免許証など。）")!;
    expect(outer.host.localName).toBe("gk-run");
    expect(outer.placement).toBe("after");
    expect(byFirst.get("平日 午前8時30分から午後5時まで")).toMatchObject({
      kind: "table-cell",
      placement: "inside",
    });
  });

  test("本文の範囲が見つからないときは body を使い、header/footer を除く", () => {
    const doc = parse(
      "<body><header><p>ヘッダーです。</p></header><div><p>本文です。とても大事です。</p></div><footer>フッター。</footer></body>",
    );
    expect(findContentRoot(doc).localName).toBe("body");
    expect(segmentDocument(doc).sentences.map((s) => s.text)).toEqual([
      "本文です。",
      "とても大事です。",
    ]);
  });
});

describe("wrapInSentence", () => {
  test("空白の違いを無視して anchor を包む", () => {
    const doc = parse(SAMPLE);
    segmentDocument(doc);
    const made = wrapInSentence(doc, "s2", "転入届が必要です", () => doc.createElement("gk-a"));
    expect(made.map((m) => m.textContent).join("")).toBe("転入届が必要です");
    // 改行をまたぐ anchor も見つける
    const across = wrapInSentence(doc, "s2", "ときは、転入届", () => doc.createElement("gk-a"));
    expect(across.length).toBeGreaterThan(0);
  });

  test("見つからなければ何もしない", () => {
    const doc = parse(SAMPLE);
    segmentDocument(doc);
    expect(wrapInSentence(doc, "s2", "存在しない言葉", () => doc.createElement("gk-a"))).toEqual(
      [],
    );
  });
});
