---
title: はじめる
description: Node と pnpm の入れ方・install と、TPM 担当を起こす 1 行の出し方。信頼のダイアログ
---

## Node と pnpm を入れる

Node の version は repo の一番上の `.node-version` で決める（GitHub Actions も同じファイルを読む）。nodenv で入れる。

```sh
cd </foo/bar/skills> # skillsの置き場所
nodenv install       # .node-version の version を入れる（入っていれば何もしない）
npm install -g corepack && corepack enable && nodenv rehash   # pnpm を出す（Node 25 から corepack は Node に入っていない）
pnpm -v              # packageManager（package.json）の版が出る
```

pnpm は Node の version ごとに入る。`.node-version` を上げたら、新しい version でもう 1 度 corepack を入れる。合わない Node で `pnpm install` を打つと、`engines.node` の誤りで止まる（`pnpm-workspace.yaml` の `engineStrict`）。

## 起動のしかた

`cli/bin/tpm start` が出す 1 行を写して打つ。

```sh
cd </foo/bar/skills> # skillsの置き場所
pnpm --dir cli install --frozen-lockfile   # build は無い（tpm は src/ を node で直に動かす）
cd </your/workspace> # あなたが作業する場所
/foo/bar/skills/cli/bin/tpm start --verbose             # 今いる folder で TPM 担当を起こす 1 行を出す
/foo/bar/skills/cli/bin/tpm start --verbose <folder>    # その folder で起こす 1 行を出す
```

`tpm start` は claude を起こさない。folder の `.claude/roles/config.jsonc` の `skill-sets` を確かめて、次の 1 行を出すだけ。それをそのまま打てばClaude Codeが適切に起動する。`PATH=…` は、TPM 担当が `tpm` を名前だけで打てるようにする。`--settings` は、shell の命令を実行の前に `tpm guard` に見せる hook（[担当のあいだの決まり](/protocol/#guard)）。`<repo>` は skills を置いた場所（上の例なら `/foo/bar/skills`）に替わる。違う場所に置いたときも、`<repo>` のところだけが変わる（場所に空白などがあれば `tpm start` が引用符も付けるので、出た 1 行をそのまま写す）。

```sh
# skill-sets が無い（既定）
cd <folder> && PATH=<repo>/cli/bin:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"<repo>/cli/bin/tpm guard"}]}]}}' --add-dir <repo>/skill-sets/core -- /tpm
# "skill-sets": ["dependabot"]
cd <folder> && PATH=<repo>/cli/bin:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"<repo>/cli/bin/tpm guard"}]}]}}' --add-dir <repo>/skill-sets/core <repo>/skill-sets/dependabot -- /tpm
```

**最初の入力は `--` の後に置く**（`--add-dir` は後ろの語もまとめて folder として読むため）。

### model と effort を替える

上の 1 行の `--model claude-opus-5-5 --effort medium --permission-mode bypassPermissions` は既定。替えるときは 1 行を書き替えず、環境変数 `TPM_MODEL`・`TPM_EFFORT`・`TPM_PERMISSION_MODE` を書いてから `tpm start` を打つ。

```sh
# いつも替える: shell の profile（~/.zshrc など）で export する。TPM 担当にも、TPM 担当が起こす担当にも効く
export TPM_MODEL=claude-fable-5-2
export TPM_EFFORT=medium

# 1 回だけ替える: tpm start の前に付ける。出る 1 行を打った TPM 担当と、その TPM 担当が起こす担当に効く
TPM_EFFORT=high /foo/bar/skills/cli/bin/tpm start
```

`tpm start` は、書いてある `TPM_MODEL`・`TPM_EFFORT`・`TPM_PERMISSION_MODE` を 1 行の頭（`PATH=…` の隣）にも写す。1 回だけ付けた値も TPM 担当の Claude Code の環境に入るので、TPM 担当の状態の `model` と、`tpm assign` で起こす担当に、profile に書いたときと同じに効く。

```sh
# TPM_EFFORT=high tpm start が出す 1 行（skill-sets が無いとき）
cd <folder> && PATH=<repo>/cli/bin:"$PATH" TPM_EFFORT=high claude --model claude-opus-5-5 --effort high --permission-mode bypassPermissions --settings '…' --add-dir <repo>/skill-sets/core -- /tpm
```

欄ごとに、命令の旗（`tpm assign --model` など）> `.claude/roles/config.jsonc` の担当の欄 > 環境変数 > コードの既定 の順で、先に値がある物が使われる。project の config に `"devops-engineer": { "effort": "low" }` と書いてあれば、`TPM_EFFORT=high` でもその project の DevOps Engineer 担当は low のまま。表は[設定](/configuration/#model-などの既定の環境変数任意)。

## 信頼のダイアログ

`--add-dir` の先が信頼されていないと、対話で起こしたときに「Adding a new directory … trust?」のダイアログで止まる（既定は No・`-p` では出ない）。

![信頼のダイアログ。「Adding a new directory:」と folder の path の下に、This session hasn't worked here before. Is this a directory you created or one you trust? と No, exit（既定）・Yes, add it が出る](../../assets/screens/trust-dialog.webp)

画面は「Adding a new directory:」と folder の path の下の部分。

- 信頼は、信頼した folder が git の repo ならその repo 全体に、そうでなければその下の全部に効く。**この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない**（信頼済みの folder の下の、git の repo でない folder では出なかった）。
- 置いた場所ごとに、**この repo の folder で 1 度 Claude Code を対話で起こし**、「Yes, I trust this folder」を選んでおく。信頼は残る。
- 起こした担当がこのダイアログで止まると、担当が名乗らない。`tpm assign` は 90 秒待っても名乗らなければ画面を読み、このダイアログなら Yes を押さずに閉じて、人に信頼を頼むよう返す。
