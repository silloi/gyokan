/**
 * 「本文を貼り付け」モード: 貼り付けた文章を、URL のときと同じ表示にのせるための簡単な HTML にする。
 * 空行で段落を分け、「・」「●」「-」などで始まる行は箇条書き、【】や■で始まる短い行は見出しにする。
 */

const BULLET = /^\s*([・●○◆◇■□▪▫\-*•]|\d+[.．、)）]|[（(]\d+[)）]|[①-⑳])\s*/;
const HEADING = /^\s*(【[^】]{1,30}】|[■◆●]\s*\S.{0,28})\s*$/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STYLE = `
body { margin: 0; background: #fff; color: #222; font: 16px/1.8 "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 20px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
h2 { font-size: 18px; margin: 28px 0 10px; }
p { margin: 0 0 1em; }
ul { list-style: none; padding-left: 0.6em; }
`;

export function textToHtml(text: string, title = "貼り付けた文章"): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (HEADING.test(trimmed)) {
      flushList();
      out.push(`<h2>${esc(trimmed)}</h2>`);
    } else if (BULLET.test(trimmed)) {
      list.push(trimmed);
    } else {
      flushList();
      out.push(`<p>${esc(trimmed)}</p>`);
    }
  }
  flushList();
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main><h1 data-gk-ui>${esc(title)}</h1>${out.join("\n")}</main></body></html>`;
}
