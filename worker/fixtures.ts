/**
 * Worker に同梱する補足データ（fixture）。本文のハッシュで照合する。
 * API キーが無くてもデモページを表示できるようにするため。
 */
import type { AnnotationSet } from "../shared/types.ts";

const modules = import.meta.glob<AnnotationSet>("../fixtures/*.annotations.json", {
  eager: true,
  import: "default",
});
const byHash = new Map(Object.values(modules).map((set) => [set.pageHash, set]));

export function findFixture(hash: string): AnnotationSet | undefined {
  return byHash.get(hash);
}
