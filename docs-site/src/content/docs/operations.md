---
title: 運用
description: この repo を別の folder へ移す手順
---

## 移す手順

1. TPM 担当のほかに動いている担当（Software Engineer・DevOps Engineer・Sustaining Engineer）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（[信頼のダイアログ](/getting-started/#信頼のダイアログ)。信頼は path に付くので、移すたびに要る）。
4. 新しい folder で `pnpm install --frozen-lockfile` と `pnpm run build` を打ち、`~/.local/bin/tpm` の symlink を張り直す（`ln -sf <新しい folder>/bin/tpm ~/.local/bin/tpm`）。
5. 動いている TPM 担当は、起こし直すか `/add-dir <新しい folder>/core`（追加の skill セットを足していれば、その skill セットの folder も）を打つ。ほかの担当を起こす旗は `/tpm` と `/dependabot-triage` が自分の場所から求めるので直さない。
