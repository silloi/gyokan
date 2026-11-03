/**
 * 取得したページの HTML から、スクリプトや外部への誘導を取り除く（HTMLRewriter）。
 * 見た目（CSS・画像）は残す。
 *
 * Workers Free の CPU 時間は短いので、全要素に JavaScript の処理を走らせない（セレクタで対象を絞る）。
 * on* 属性などの細かい掃除は表示側（src/lib/frame.ts）で行い、iframe は sandbox（スクリプト不可）と CSP で守る。
 */

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const remove = {
  element: (el: Element) => {
    el.remove();
  },
};

export async function sanitizeHtml(html: string, baseUrl: string): Promise<string> {
  let headSeen = false;
  const baseTag = `<base href="${escapeAttr(baseUrl)}">`;
  const dropAttr = (name: string) => ({
    element: (el: Element) => {
      el.removeAttribute(name);
    },
  });
  const rewriter = new HTMLRewriter()
    // スクリプト類・入れ子のフレーム・既存の <base> は消す。
    // <noscript> は、スクリプトを止めた iframe では表示されてしまう（元の見た目と変わる）ので消す
    .on(
      "script, noscript, iframe, frame, frameset, object, embed, applet, portal, base, template",
      remove,
    )
    .on("meta[http-equiv]", {
      element: (el) => {
        if (
          /refresh|set-cookie|content-security-policy/i.test(el.getAttribute("http-equiv") ?? "")
        ) {
          el.remove();
        }
      },
    })
    .on("link", {
      element: (el) => {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase();
        // 見た目に必要なスタイルシートとアイコン以外（preload, prefetch, manifest など）は消す
        if (!/(^|\s)(stylesheet|icon)(\s|$)/.test(rel)) {
          el.remove();
          return;
        }
        // 別オリジンから読むので、CORS が必要になる属性は外す
        el.removeAttribute("integrity");
        el.removeAttribute("crossorigin");
      },
    })
    .on('[href^="javascript:" i]', dropAttr("href"))
    .on('[src^="javascript:" i]', dropAttr("src"))
    .on('[action^="javascript:" i]', dropAttr("action"))
    .on("head", {
      element: (el) => {
        headSeen = true;
        el.prepend(baseTag, { html: true });
      },
    });

  let out = await rewriter
    .transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }))
    .text();
  if (!headSeen) {
    // <head> が無い HTML: doctype の後ろに <base> を入れる（先頭に置くと互換モードになる）
    const doctype = /^\s*<!doctype[^>]*>/i.exec(out);
    out = doctype ? doctype[0] + baseTag + out.slice(doctype[0].length) : baseTag + out;
  }
  return out;
}
