/**
 * 取得したページを iframe（sandbox="allow-same-origin"、スクリプトは動かない）に入れるための下ごしらえ。
 * サーバー側でもサニタイズ済みだが、表示側でも同じ処理をして二重に守る。
 */
import frameCss from "./frame.css?raw";
import tokensCss from "./tokens.css?raw";

/** 行間が下ごしらえした文書の印（初期の about:blank と区別する） */
export const DOC_MARK = "data-gk-doc";

const REMOVE =
  "script, noscript, iframe, frame, frameset, object, embed, applet, portal, base, template, meta[http-equiv]";
const DANGEROUS_URL = /^\s*(javascript|vbscript|data:text\/html)/i;

export function prepareDocument(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(REMOVE).forEach((el) => el.remove());
  doc.querySelectorAll("link").forEach((el) => {
    if (!/(^|\s)(stylesheet|icon)(\s|$)/i.test(el.getAttribute("rel") ?? "")) el.remove();
    el.removeAttribute("integrity");
    el.removeAttribute("crossorigin");
  });
  doc.querySelectorAll("*").forEach((el) => {
    for (const { name, value } of Array.from(el.attributes)) {
      const n = name.toLowerCase();
      if (
        n.startsWith("on") ||
        n === "srcdoc" ||
        (/^(href|src|action|formaction|data|poster)$/.test(n) && DANGEROUS_URL.test(value))
      ) {
        el.removeAttribute(name);
      }
    }
  });

  const head = doc.head;
  const base = doc.createElement("base");
  base.setAttribute("href", baseUrl);
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    "script-src 'none'; object-src 'none'; frame-src 'none'; upgrade-insecure-requests",
  );
  const referrer = doc.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  head.prepend(csp, referrer, base);

  const style = doc.createElement("style");
  style.setAttribute("data-gk-ui", "");
  // 色のトークン（アプリと共通）と、補足の見た目
  style.textContent = `${tokensCss}\n${frameCss}`;
  head.append(style);

  doc.documentElement.setAttribute(DOC_MARK, "");
  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : "";
  return doctype + doc.documentElement.outerHTML;
}
