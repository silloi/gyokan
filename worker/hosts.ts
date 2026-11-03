/**
 * 取得してよいホストの判定（純粋関数。テストしやすいよう page.ts から分けている）。
 */

/** localhost・プライベート IP・リンクローカルなど、外の公開サイトではないホスト */
const PRIVATE_HOST =
  /^(localhost|.+\.localhost|.+\.local|.+\.internal|0\.0\.0\.0|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2}|\[[0-9a-f:.]*\])$/i;

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST.test(hostname);
}

/**
 * ALLOWED_HOSTS で読めるサイトを絞る。"*"（既定）なら制限なし。
 * 絞るときは ".go.jp,.lg.jp,www.jlpt.jp" のように、"." で始まるものは末尾一致、それ以外は完全一致。
 */
export function isAllowedHost(hostname: string, allowed: string | undefined): boolean {
  const rules = (allowed ?? "*")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0 || rules.includes("*")) return true;
  const host = hostname.toLowerCase();
  return rules.some((rule) =>
    rule.startsWith(".") ? host.endsWith(rule) || host === rule.slice(1) : host === rule,
  );
}
