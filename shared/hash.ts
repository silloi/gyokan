import type { SentenceRef } from "./types.ts";

/**
 * ページ本文（文の並び）のハッシュ。補足のキャッシュと fixture の照合に使う。
 * URL ではなく本文から作るので、ページが更新されれば別のキーになる。
 */
export async function pageHash(
  sentences: readonly Pick<SentenceRef, "id" | "blockId" | "text">[],
): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify(sentences.map((s) => [s.id, s.blockId, s.text])),
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
