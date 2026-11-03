# 行間（gyokan）

公的機関（や公的な性格のサービス）のウェブページを、原文は変えずに、**各行の下に**補足（ことば／言い回し／文脈／書かれていない前提）を差し込んで表示する Web アプリ。進捗と未決の判断は `PROGRESS.md`。仕様書 `docs/SPEC.md` は git 管理外（手元にあるときだけ読める）。

## 守ること

- **原文のテキストは1文字も変えない。** 補足は `gk-*` 要素として足すだけ。`shared/segment.test.ts` の「原文のテキストは変わらない」を壊さない。
- **補足は各行の下（`gk-line`）。原文の折り返しを変えない。** 補足の行は行末に入れる幅 100% のインラインブロックで、`<br>` で終わる行は `<br>` の直前に入れる（行頭の全角空白の字下げを動かさないため）。表示を変えたら、つまみ 0 と 4 で各行の始まりの文字が同じかを確かめる。
- ふりがな（語の上の読み）は出さない。読みは根拠パネルにだけ出す。
- 補足の行には本文とバッジ（かならず・推測など）だけを出す。レベルは色、どの語への補足かは位置で示し、レベル名や語は書かない（ツールチップ・`aria-label`・根拠パネルに出す）。
- 補足の根拠（evidence）は原文からの完全一致の引用。照合できないものは「推測」に下げる（`shared/validate.ts`）。レベル4は必ず「推測」を表示する。
- 取得したページ本体は保存・再配布しない（キャッシュは補足データだけ）。実在のページの HTML・スクリーンショット・本文をリポジトリに入れない。実在のページに付けた補足は `local-notes/`（git 管理外、本文なし）。テスト用のページは架空のもの（`public/demo/`）を使う。
- 補足の文章は `shared/yasashii.ts` の基準（短い文、敬語なし、行政語なし、レベル4は断定しない）に合わせる。下書きは `scripts/build-fixture.ts --strict` で検証してから使う。
- `shared/prompts.ts` を変えたら `PROMPT_VERSION` を上げる（KV キャッシュのキーに入る）。
- `shared/segment.ts` / `shared/sentences.ts` を変えると文 ID とハッシュが変わり、fixture や取り込んだ補足が使われなくなる。変えたら作り直す（`fixtures/fixtures.test.ts` が架空ページの分を検知する）。
- 取得時の User-Agent は「GyokanReader」と名乗り、ブラウザに偽装しない。
- Claude API は `claude-opus-5-5`、構造化出力（`output_config.format`）、`fallbacks: "default"`（beta `server-side-fallback-2026-07-01`）。

## 構成

- `shared/` 共通: `segment.ts`（DOM の文分割・本文の範囲の推定）、`sentences.ts`（文分割・`<br>` の扱い）、`prompts.ts`（全レベル共通の system ＋レベル別の指示）、`generate.ts`（Claude 呼び出し＋書き直し）、`validate.ts`、`yasashii.ts`
- `worker/` Cloudflare Worker: `/api/page`（Browser Rendering → fetch にフォールバック → HTMLRewriter でサニタイズ）、`/api/annotate`（fixture → 取り込んだ補足 → KV キャッシュ → Claude）、`/api/dev/import`（開発用、`DEV_TOOLS=1` のときだけ）、`hosts.ts`（取得してよいホスト）
- `src/` Vue 3: `PageView.vue`（sandbox iframe に表示し、親から DOM を操作・幅が変わったら測り直す）、`lib/render.ts`（行を測って各行の下に補足を差し込む）、`lib/frame.css`（iframe 内のスタイル）
- `scripts/` CLI（`vpx` で実行）: `segment-page.ts`、`annotate-page.ts`、`build-fixture.ts`、`import-notes.ts`

## 開発メモ

- root で動くコンテナでは `CI=1 vp dev`（Miniflare がローカルの Chrome に `--no-sandbox` を付けるのは `CI` があるときだけ）。
- Miniflare はローカルの Chrome を空の環境変数で起動するので、HTTPS プロキシが必要な環境では Chrome のポリシー（`/etc/opt/chrome_for_testing/policies/managed/*.json` の `ProxyMode`/`ProxyServer`）でプロキシを指定する。プロキシのポートはコンテナの再起動で変わるので、`ERR_PROXY_CONNECTION_FAILED` が出たら `$HTTPS_PROXY` の値で書き直す。ローカルの workerd の fetch はプロキシを使わない（本番では問題ない）。
- Playwright で確認するときは、ブラウザの UA を通常の Chrome にする（既定の「HeadlessChrome」だと、入管などのサイトが CSS・画像を返さない）。
- `wrangler.jsonc` を変えたら `vp exec wrangler types` で `worker-configuration.d.ts` を作り直す。
- 確認は `vp check`、`vp exec vue-tsc -b`、`vp test`。

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
