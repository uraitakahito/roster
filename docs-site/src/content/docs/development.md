---
title: 開発
description: 試験の流し方・Dependabot の判定の道具・この docs の見方と公開の流れ
---

## 試験

TypeScript の道具（`tpm` と判定の道具）は `cli/` の pnpm の project にある。試験は `cli/` で打つ。

```sh
cd cli
pnpm install --frozen-lockfile
pnpm run typecheck   # 型の検査（tsc）
pnpm run lint        # ESLint
pnpm run build       # test/cli.test.ts は build 済みの dist/ を動かすので、試験の前に打つ
pnpm test            # Vitest
```

`pnpm test` は build をしない。`dist/` が無いと `test/cli.test.ts` が「先に pnpm run build を打ってください」で落ちる。GitHub Actions でも同じ順に流す（`.github/workflows/test.yml`）。

## 判定の道具

Dependabot の PR の判定の道具は `cli/src/release-age.ts`（`node cli/src/release-age.ts <owner>/<repo> <PR> [--hours <時間>] [--now <ISO 時刻>]`）。version は PR の差分（pnpm-lock・package-lock・yarn.lock・workflow の `uses:`）から読み、依存の依存も数える。終了コードは 0 対象・10 まだ・20 判定できない・1 道具の誤り。

## この docs

原稿は `docs-site/src/content/docs/` の Markdown（Astro + Starlight）。`docs-site/` は `cli/` と別の pnpm の project で、依存と lockfile を自分で持つ。

```sh
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site run dev            # 手元で見る（http://localhost:4321/skills/）
pnpm --dir docs-site run check          # build と、原稿と repo の食い違いの検査
pnpm --dir docs-site run format         # code（astro.config.ts・src/ の .ts・scripts/）を Prettier で整える
pnpm --dir docs-site run format:check   # 整っているかだけを見る（site.yml が流す）
```

Prettier は既定の設定のまま使い、設定のファイルは置かない。原稿の `.md` は Prettier に掛けない（表や日本語の折り返しを崩させないため）。`cli/` の整形は Prettier でなく ESLint（`@stylistic`）が見る。

`astro build` は `.md` のページの中で何が落ちても exit 0 で終わるので、`check` は build の後に `docs-site/scripts/check-refs.mjs` を流す。見る物は、ページへのリンク・本文が名指した repo の path（git が追跡する物と、add 前の新しい物だけを数える。build の書き出しなど `.gitignore` にある物は、手元に在っても無いとみなす）・README の URL・skill が名指す原稿の見出し・`config.json` の欄の揃い・skill の中の相対パス（`${CLAUDE_SKILL_DIR}/…` の先）・skill が名指す `_shared/` の決まりの見出し・画面の絵（`docs-site/src/assets/screens/`）と本文の参照の揃い。Mermaid の図は書き間違えても検査を通るので、図を変えたら手元で見る。

skill は Pages ではなく原稿の Markdown を読む（`/dependabot-triage` と `/sustaining-engineer` が [設定](/configuration/) を読む）。原稿の見出しや表を変えたら、`check` が skill の読む先を確かめる。

### 公開の流れ

main への push のたびに https://uraitakahito.github.io/skills/ に出す（この repo にタグは無い）。

```mermaid
flowchart LR
  PR["PR"] --> T["test.yml<br/>試験"]
  PR --> C["site.yml<br/>check・format:check（公開しない）"]
  PR -->|"CI が緑 → merge"| M["main"]
  M --> T2["test.yml"]
  M --> D["docs.yml<br/>check → upload-pages-artifact"]
  D --> P["deploy-pages<br/>uraitakahito.github.io/skills/"]
```
