---
title: 運用
description: この repo を別の folder へ移す手順と、Node の version の上げ方
---

## 移す手順

1. TPM 担当のほかに動いている担当（Software Engineer・DevOps Engineer・Sustaining Engineer）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（[信頼のダイアログ](/getting-started/#信頼のダイアログ)。信頼は path に付くので、移すたびに要る）。
4. 新しい folder で `pnpm --dir cli install --frozen-lockfile` を打つ。`~/.local/bin/tpm` の symlink を張っていれば張り直す（`ln -sf <新しい folder>/cli/bin/tpm ~/.local/bin/tpm`）。
5. 動いている TPM 担当は、`tpm start` の 1 行で起こし直す（guard の hook と `tpm` の在り処が古い folder を指しているため）。担当を起こす旗は `tpm assign` が自分の場所から求めるので直さない。

使う側の project（TPM 担当を起こす folder）を移したときは、状態の folder（`~/.local/state/tpm/<project の path から作った名>/`）も変わる。担当が 0 のときに移せば、古い folder は消してよい。

## Node の version を上げる

1. repo の一番上の `.node-version` を新しい version（`26.14.0` のように patch まで）に書き替える。nodenv は `26` のような頭だけの version を受けない。GitHub Actions の 3 つの workflow も `node-version-file` でこのファイルを読むので、ほかは書き替えない。
2. 手元で `nodenv install` と、corepack の入れ直し（[Node と pnpm を入れる](/getting-started/#node-と-pnpm-を入れる)）。
3. 新しい version で試験と docs の検査を流してから PR にする（[開発](/development/)）。major を上げるときは `cli/package.json` と `docs-site/package.json` の `engines.node` と、`@types/node` も合わせる。
