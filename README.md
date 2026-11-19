# skills

Claude Code の skill を、使う project の外に置く repo。使う側のセッションは `--add-dir` でこの repo を足して読む。旗を付けたセッションにだけ skill が出るので、ほかの作業のセッションには出ない。

## 中の skill

| skill | 呼ぶ人 | すること |
|---|---|---|
| `/dependabot-triage` | Technical Program Manager 役（TPM 役） | Dependabot の PR を集め、依存の版の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 役を起こす。merge と workspace を閉じるのも TPM 役。`一覧だけ` で表だけ |
| `/sustaining <repo>#<PR> tpm=<workspace>` | Sustaining Engineer 役（TPM 役が起こす） | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 役に merge を頼む |

判定の道具は `.claude/skills/_shared/release-age.mjs`（`node release-age.mjs <owner>/<repo> <PR> [--hours <時間>] [--now <ISO 時刻>]`）。版は PR の差分（pnpm-lock・package-lock・yarn.lock・workflow の `uses:`）から読み、依存の依存も数える。終了コードは 0 対象・10 まだ・20 判定できない・1 道具の誤り。

## 使う側の設定

使う project に次の 2 つを置く。無いと skill は止まる。

### `.claude/dependabot/config.json`

| 欄 | 中身 | 例 |
|---|---|---|
| `owner` | GitHub の owner | `"example-org"` |
| `repos` | 対象の repo の名前の配列（fork などは入れない） | `["app", "lib"]` |
| `cwd` | Sustaining Engineer 役を起こす folder（無ければ使う側の project の folder） | `"/path/to/workspace"` |
| `maxConcurrent` | 同時に動かす Sustaining Engineer 役の数 | `3` |
| `hours` | 依存の版の公開から何時間たったら merge を検討するか | `72` |
| `model` | Sustaining Engineer 役の model | `"claude-opus-5-5"` |
| `effort` | Sustaining Engineer 役の effort | `"medium"` |
| `modelLabel` | サイドバーに出す字 | `"Opus 5.5 · medium"` |
| `permissionMode` | Sustaining Engineer 役の `--permission-mode` | `"bypassPermissions"` |
| `mergeMethod` | `gh pr merge` の方法 | `"squash"` |
| `rebaseWaitMinutes` | `@dependabot rebase` の応じた印 👍 を待つ分 | `20` |

### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。

## 起動のしかた

TPM 役を起こす命令に `--add-dir <この repo の folder>` を付ける。**依頼の文は `--` の後に置く**（`--add-dir` は後ろの語もまとめて folder として読むため）。

```sh
claude --model claude-opus-5-5 --effort <段> --permission-mode bypassPermissions \
  --add-dir <この repo の folder> -- "<依頼>"
```

Sustaining Engineer 役を起こす 1 行は、`/dependabot-triage` が自分の場所（`${CLAUDE_SKILL_DIR}/../../..`）から組むので、人は打たない。起こした後、サイドバーに `wait=作業中: …` が出たか（`cmux sidebar-state --workspace <workspace>`）で、skill が読まれたことを確かめる。題は起こすときに `--name` で付けるので、見分けに使えない。

動いているセッションに途中から足すときは `/add-dir <この repo の folder>`。信頼していない folder だとダイアログが出るので、↓ と Enter で「Yes, add it」を選ぶ。

## 信頼のダイアログ

`--add-dir` の先が信頼されていないと、対話で起こしたときに「Adding a new directory … trust?」のダイアログで止まる（既定は No・`-p` では出ない）。

- 信頼は、信頼した folder が git の repo ならその repo 全体に、そうでなければその下の全部に効く。**この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない**（信頼済みの folder の下の、git の repo でない folder では出なかった）。
- 置いた場所ごとに、**この repo の folder で 1 度 Claude Code を対話で起こし**、「Yes, I trust this folder」を選んでおく。信頼は残る。
- 起こした Sustaining Engineer 役がこのダイアログで止まると、サイドバーに `wait` が出ない。`/dependabot-triage` は Yes を押さずに閉じ、人に信頼を頼む。

## 移す手順

1. 動いている Sustaining Engineer 役が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（上の「信頼のダイアログ」。信頼は path に付くので、移すたびに要る）。
4. TPM 役を起こす命令（Snippets など）の `--add-dir` の path を 1 か所替える。
5. 動いている TPM 役は、起こし直すか `/add-dir <新しい folder>` を打つ。Sustaining Engineer 役の旗は skill が自分で求めるので直さない。

## 試験

```sh
node --test .claude/skills/_shared/
```

GitHub Actions でも同じ試験を流す（`.github/workflows/test.yml`）。
