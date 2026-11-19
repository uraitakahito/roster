# skills

## ドキュメント

https://uraitakahito.github.io/skills/

## skillで呼び出される担当者

| 担当 | 人間かAIか |
|---|---|
| `Product Manager` | 人間 |
| `Technical Program Manager` | AI |
| `Software Engineer` | AI |
| `DevOps Engineer` | AI |
| `Sustaining Engineer` | AI |

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

**最初の入力は `--` の後に置く**（`--add-dir` は後ろの語もまとめて folder として読むため）。最初の入力はいつも `/tpm`。`skill-sets` で変わるのは `--add-dir` だけ。

### `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | folder | skill |
|---|---|---|
| core | `core/.claude/skills/` | `/tpm`・`/software-engineer`・`/devops-engineer`・`_shared/protocol.md` |
| dependabot | `dependabot/.claude/skills/` | `/dependabot-triage`・`/sustaining-engineer`・`_shared/release-age.mjs` |

core はいつも足す。追加の skill セットは、起こす folder の `.claude/roles/config.json` の `skill-sets` に書いたときだけ足す（下の「使う側の設定」）。skill セットは兄弟の folder に置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer tpm=<surface> brief=<URL> [jira=<課題>]` | TPM | Software Engineer | 課題 1 つを受け持つ。依頼書（Artifact）を読み、調査・提案・計画・実装・テストを worktree で進め、成果を Artifact と PR で出す |
| `/devops-engineer tpm=<surface> [brief=<URL>] [jira=<課題>]` | TPM | DevOps Engineer | Apple Container と Windmill のビルド・デプロイ・環境の整備。課題間のconflict等は TPM 担当に相談する |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と workspace を閉じるのも TPM 担当。`dry-run` で表だけ |
| `/sustaining-engineer <repo>#<PR> tpm=<workspace>` | TPM | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |

## 担当のあいだの決まり

「連絡の仕方と見出し・サイドバーの `model` と `wait`・Product Manager への確かめ方・文書の食い違い・共有の環境・終わり方」は `core/.claude/skills/_shared/protocol.md` の 1 か所に書き、どの担当もそれを読む。TPM 担当が書く依頼書には、その課題だけのことを書く（ひな形は `core/.claude/skills/tpm/brief-template.md`）。

判定の道具は `dependabot/.claude/skills/_shared/release-age.mjs`（`node release-age.mjs <owner>/<repo> <PR> [--hours <時間>] [--now <ISO 時刻>]`）。version は PR の差分（pnpm-lock・package-lock・yarn.lock・workflow の `uses:`）から読み、依存の依存も数える。終了コードは 0 対象・10 まだ・20 判定できない・1 道具の誤り。

## 使う側の設定

### `.claude/roles/config.json`（任意）

TPM 担当を起こした folder に置くと、追加の skill セットと、TPM 担当が起こす担当の既定を替えられる。

| 欄 | 中身 | 無いとき |
|---|---|---|
| `skill-sets` | core のほかに加える、追加の skill セットの名前の配列（`bin/tpm` が読む） | core だけ |
| `software-engineer`・`devops-engineer` | 起こす担当の `model`・`effort`・`permissionMode`（`/tpm` が読む） | `/tpm` の表の既定（Software Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、どちらも `bypassPermissions`） |

```json
{ "skill-sets": ["dependabot"],
  "software-engineer": { "model": "claude-opus-5-5", "effort": "high", "permissionMode": "bypassPermissions" },
  "devops-engineer": { "model": "claude-opus-5-5", "effort": "low", "permissionMode": "bypassPermissions" } }
```

### Dependabot の設定

Dependabot の skill を使う project では、`.claude/roles/config.json` の `skill-sets` に `"dependabot"` を書き、次の 2 つを置く。`/tpm` の起動では Dependabot の PR を見ない。Product Manager が言ったときに TPM 担当が `/dependabot-triage` を呼ぶ。skill セットを書かなければ `/dependabot-triage` は使えない。skill セットを書いても 2 つが無いと `/dependabot-triage` と `/sustaining-engineer` は止まる。

#### `.claude/dependabot/config.json`

| 欄 | 中身 | 例 |
|---|---|---|
| `owner` | GitHub の owner | `"example-org"` |
| `repos` | 対象の repo の名前の配列（fork などは入れない） | `["app", "lib"]` |
| `cwd` | Sustaining Engineer 担当を起こす folder（無ければ使う側の project の folder） | `"/path/to/workspace"` |
| `maxConcurrent` | 同時に動かす Sustaining Engineer 担当の数 | `3` |
| `hours` | 依存の version の公開から何時間たったら merge を検討するか | `72` |
| `model` | Sustaining Engineer 担当の model | `"claude-opus-5-5"` |
| `effort` | Sustaining Engineer 担当の effort | `"medium"` |
| `modelLabel` | サイドバーに出す字 | `"Opus 5.5 · medium"` |
| `permissionMode` | Sustaining Engineer 担当の `--permission-mode` | `"bypassPermissions"` |
| `mergeMethod` | `gh pr merge` の方法 | `"squash"` |
| `rebaseWaitMinutes` | `@dependabot rebase` の応じた印 👍 を待つ分 | `20` |

#### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。

## 信頼のダイアログ

`--add-dir` の先が信頼されていないと、対話で起こしたときに「Adding a new directory … trust?」のダイアログで止まる（既定は No・`-p` では出ない）。

- 信頼は、信頼した folder が git の repo ならその repo 全体に、そうでなければその下の全部に効く。**この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない**（信頼済みの folder の下の、git の repo でない folder では出なかった）。
- 置いた場所ごとに、**この repo の folder で 1 度 Claude Code を対話で起こし**、「Yes, I trust this folder」を選んでおく。信頼は残る。
- 起こした担当がこのダイアログで止まると、サイドバーに `wait` が出ない。`/tpm` と `/dependabot-triage` は Yes を押さずに閉じ、人に信頼を頼む。
- 信頼済みのこの repo の git worktree（repo の隣の folder）を `--add-dir` で足しても、ダイアログは出なかった。起こす folder（cwd）が信頼されていないと、cwd の方でダイアログが出る。

## 移す手順

1. TPM 担当のほかに動いている担当（Software Engineer・DevOps Engineer・Sustaining Engineer）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（上の「信頼のダイアログ」。信頼は path に付くので、移すたびに要る）。
4. 新しい folder で `pnpm install --frozen-lockfile` と `pnpm run build` を打ち、`~/.local/bin/tpm` の symlink を張り直す（`ln -sf <新しい folder>/bin/tpm ~/.local/bin/tpm`）。
5. 動いている TPM 担当は、起こし直すか `/add-dir <新しい folder>/core`（追加の skill セットを足していれば、その skill セットの folder も）を打つ。ほかの担当を起こす旗は `/tpm` と `/dependabot-triage` が自分の場所から求めるので直さない。

## 試験

```sh
pnpm install --frozen-lockfile
pnpm run typecheck   # 型の検査（tsc）
pnpm run lint        # ESLint
pnpm run build       # test/cli.test.ts は build 済みの dist/ を動かすので、試験の前に打つ
pnpm test            # Vitest
```

`pnpm test` は build をしない。`dist/` が無いと `test/cli.test.ts` が「先に pnpm run build を打ってください」で落ちる。GitHub Actions でも同じ順に流す（`.github/workflows/test.yml`）。
