---
title: はじめる
description: install・build と、TPM 担当を起こす 1 行の出し方。信頼のダイアログ
---

## 起動のしかた

`bin/tpm` が出す 1 行を写して打つ。

```sh
cd </foo/bar/skills> # skillsの置き場所
pnpm install --frozen-lockfile
pnpm run build
cd </your/workspace> # あなたが作業する場所
/foo/bar/skills/bin/tpm --verbose             # 今いる folder で TPM 担当を起こす 1 行を出す
/foo/bar/skills/bin/tpm --verbose <folder>    # その folder で起こす 1 行を出す
```

`tpm` は claude を起こさない。自分の場所からこの repo を求め、folder の `.claude/roles/config.json` の `skill-sets` を確かめて、次の 1 行を出すだけ。それを写して打つ。

```sh
# skill-sets が無い（既定）
cd <folder> && claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --add-dir <repo>/core -- /tpm
# "skill-sets": ["dependabot"]
cd <folder> && claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --add-dir <repo>/core <repo>/dependabot -- /tpm
```

**最初の入力は `--` の後に置く**（`--add-dir` は後ろの語もまとめて folder として読むため）。最初の入力はいつも `/tpm`。`skill-sets` で変わるのは `--add-dir` だけ（[skill セット](/skill/#--add-dir-の先の-skill-セット)）。

## 信頼のダイアログ

`--add-dir` の先が信頼されていないと、対話で起こしたときに「Adding a new directory … trust?」のダイアログで止まる（既定は No・`-p` では出ない）。

- 信頼は、信頼した folder が git の repo ならその repo 全体に、そうでなければその下の全部に効く。**この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない**（信頼済みの folder の下の、git の repo でない folder では出なかった）。
- 置いた場所ごとに、**この repo の folder で 1 度 Claude Code を対話で起こし**、「Yes, I trust this folder」を選んでおく。信頼は残る。
- 起こした担当がこのダイアログで止まると、サイドバーに `wait` が出ない。`/tpm` と `/dependabot-triage` は Yes を押さずに閉じ、人に信頼を頼む。
- 信頼済みのこの repo の git worktree（repo の隣の folder）を `--add-dir` で足しても、ダイアログは出なかった。起こす folder（cwd）が信頼されていないと、cwd の方でダイアログが出る。
