# skills

Claude Code の skill を、使う project の外に置く repo。使う側のセッションは `--add-dir` でこの repo を足して読む。旗を付けたセッションにだけ skill が出るので、ほかの作業のセッションには出ない。

## skillで呼び出される担当者

| 担当 | 人間かAIか |
|---|---|
| `Product Manager` | 人間 |
| `Technical Program Manager` | AI |
| `Software Engineer` | AI |
| `DevOps Engineer` | AI |
| `Sustaining Engineer` | AI |

## skill

| skill | 呼ぶ人 | すること |
|---|---|---|
| `/tpm` | TPM 役（`bin/tpm` が起こす） | Product Manager を助け、課題ごとに Software Engineer 役・DevOps Engineer 役を起こす。起きたとき、Dependabot の設定があれば `/dependabot-triage` を呼ぶ |
| `/software-engineer tpm=<surface> brief=<URL> [jira=<課題>]` | Software Engineer 役（TPM 役が起こす） | 課題 1 つを受け持つ。依頼書（Artifact）を読み、調査・提案・計画・実装・テストを worktree で進め、成果を Artifact と PR で出す |
| `/devops-engineer tpm=<surface> [brief=<URL>] [jira=<課題>]` | DevOps Engineer 役（TPM 役が起こす） | Apple Container と Windmill のビルド・デプロイ・環境の整備。並べて動いている物に響く操作の前は TPM 役に相談する |
| `/dependabot-triage` | Technical Program Manager 役（TPM 役） | Dependabot の PR を集め、依存の版の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 役を起こす。merge と workspace を閉じるのも TPM 役。`一覧だけ` で表だけ |
| `/sustaining-engineer <repo>#<PR> tpm=<workspace>` | Sustaining Engineer 役（TPM 役が起こす） | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 役に merge を頼む |

役のあいだの決まり（知らせの送り方と頭・サイドバーの `model` と `wait`・Product Manager への確かめ方・文書の食い違い・共有の環境・終わり方）は `.claude/skills/_shared/protocol.md` の 1 か所に書き、どの役もそれを読む。TPM 役が書く依頼書には、その課題だけのことを書く（ひな形は `.claude/skills/tpm/brief-template.md`）。

判定の道具は `.claude/skills/_shared/release-age.mjs`（`node release-age.mjs <owner>/<repo> <PR> [--hours <時間>] [--now <ISO 時刻>]`）。版は PR の差分（pnpm-lock・package-lock・yarn.lock・workflow の `uses:`）から読み、依存の依存も数える。終了コードは 0 対象・10 まだ・20 判定できない・1 道具の誤り。

## 使う側の設定

### `.claude/roles/config.json`（任意）

TPM 役を起こした folder に置くと、TPM 役が起こす役の既定を替えられる。無ければ `/tpm` の表の既定（Software Engineer 役は Opus 5.5・medium、DevOps Engineer 役は Opus 5.5・low、どちらも `bypassPermissions`）。

```json
{ "software-engineer": { "model": "claude-opus-5-5", "effort": "high", "permissionMode": "bypassPermissions" },
  "devops-engineer": { "model": "claude-opus-5-5", "effort": "low", "permissionMode": "bypassPermissions" } }
```

### Dependabot の設定

Dependabot の skill を使う project に次の 2 つを置く。無いと `/dependabot-triage` と `/sustaining-engineer` は止まる（`/tpm` は飛ばして先へ進む）。

#### `.claude/dependabot/config.json`

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

#### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。

## 起動のしかた

TPM 役は `bin/tpm` で起こす。1 度だけ PATH の通った所に symlink を張る。

```sh
ln -s <この repo の folder>/bin/tpm ~/.local/bin/tpm
tpm              # 今いる folder で TPM 役を起こす
tpm <folder>     # その folder で起こす
```

`bin/tpm` は自分の場所からこの repo を求め、`claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --add-dir <この repo の folder> -- /tpm` を起こした folder で実行する（`tpm --print` で命令だけを出す）。**最初の入力は `--` の後に置く**（`--add-dir` は後ろの語もまとめて folder として読むため）。起こした folder に `.claude/dependabot/config.json` があれば、`/tpm` が起きたときに `/dependabot-triage` を呼ぶ。

ほかの役を起こす 1 行は、`/tpm`（Software Engineer・DevOps Engineer 役）と `/dependabot-triage`（Sustaining Engineer 役）が自分の場所（`${CLAUDE_SKILL_DIR}/../../..`）から組むので、人は打たない。起こした後、サイドバーに `wait=作業中: …` が出たか（`cmux sidebar-state --workspace <workspace>`）で、skill が読まれたことを確かめる。題は起こすときに `--name` で付けるので、見分けに使えない。

動いているセッションに途中から足すときは `/add-dir <この repo の folder>`。信頼していない folder だとダイアログが出るので、↓ と Enter で「Yes, add it」を選ぶ。

## 信頼のダイアログ

`--add-dir` の先が信頼されていないと、対話で起こしたときに「Adding a new directory … trust?」のダイアログで止まる（既定は No・`-p` では出ない）。

- 信頼は、信頼した folder が git の repo ならその repo 全体に、そうでなければその下の全部に効く。**この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない**（信頼済みの folder の下の、git の repo でない folder では出なかった）。
- 置いた場所ごとに、**この repo の folder で 1 度 Claude Code を対話で起こし**、「Yes, I trust this folder」を選んでおく。信頼は残る。
- 起こした役がこのダイアログで止まると、サイドバーに `wait` が出ない。`/tpm` と `/dependabot-triage` は Yes を押さずに閉じ、人に信頼を頼む。
- 信頼済みのこの repo の git worktree（repo の隣の folder）を `--add-dir` で足しても、ダイアログは出なかった。起こす folder（cwd）が信頼されていないと、cwd の方でダイアログが出る。

## 移す手順

1. TPM 役のほかに動いている役（Software Engineer・DevOps Engineer・Sustaining Engineer）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（上の「信頼のダイアログ」。信頼は path に付くので、移すたびに要る）。
4. `~/.local/bin/tpm` の symlink を張り直す（`ln -sf <新しい folder>/bin/tpm ~/.local/bin/tpm`）。
5. 動いている TPM 役は、起こし直すか `/add-dir <新しい folder>` を打つ。ほかの役を起こす旗は `/tpm` と `/dependabot-triage` が自分の場所から求めるので直さない。

## 試験

```sh
node --test .claude/skills/_shared/ bin/
```

GitHub Actions でも同じ試験を流す（`.github/workflows/test.yml`）。
