---
title: 設定
description: 使う側の project に置く .claude/roles/config.jsonc（課題管理・連携・インフラの環境・担当の既定）と、Dependabot の skill の設定
---

## `.claude/roles/config.jsonc`（任意）

TPM 担当を起こした folder（project）に置くと、道具の選び方・追加の skill セット・起こす担当の既定を替えられる。`tpm` の命令が読む。JSONC（`//`・`/* */` のコメントと、`}`・`]` の前の末尾のカンマを許す JSON）で書く。

古い名前の `.claude/roles/config.json` があると、`tpm` の命令はそれを読まずに止まり、名前を替える `mv` を出す。中身はそのまま JSONC として読めるので、名前を替えるだけで移せる。

| 欄 | 中身 | 無いとき |
|---|---|---|
| `tracker` | 課題管理の道具。`jira`（acli）・`github`（その folder の repo の Issue。gh）・`none` | `none`（課題に記録を書かない） |
| `transport` | 担当どうしの連携の道具。`cmux`（`file` は試験用） | `cmux` |
| `infra` | インフラの環境の宣言。環境の名前（英小文字・数字・`-`）ごとに `guard`（級）と `match`（その環境に触る命令が含む字の配列） | 宣言なし（門は環境を見ない） |
| `skill-sets` | core のほかに加える、追加の skill セットの名前の配列 | core だけ |
| `software-engineer`・`devops-engineer` | 起こす担当の `model`・`effort`・`permissionMode` | 既定（Software Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、どちらも `bypassPermissions`） |

```jsonc
{
  // 課題の記録は、この folder の repo の GitHub の Issue に書く
  "tracker": "github",
  "transport": "cmux",
  "infra": {
    "apple-container": {
      "guard": "free",
      "match": ["container "],
    },
    /* staging はほかのチームも使うので、
       Product Manager の承認が要る */
    "aws-staging": {
      "guard": "pm",
      "match": ["aws ", "ssh staging"],
    },
  },
  "skill-sets": ["dependabot"],
  "software-engineer": {
    "model": "claude-opus-5-5",
    "effort": "high",
    "permissionMode": "bypassPermissions",
  },
  "devops-engineer": {
    "model": "claude-opus-5-5",
    "effort": "low",
    "permissionMode": "bypassPermissions",
  },
}
```

### 課題の鍵

| `tracker` | 鍵の形 | 記録 | 課題を閉じる |
|---|---|---|---|
| `jira` | `SKILLS-12` | コメント（ADF・段落だけ） | 状態を `完了` に進める |
| `github` | `gh-12`（`#12`・`12` も受ける） | コメント（Markdown） | `completed` で閉じる |
| `none` | `t-<短い名>` | 書かない | 何もしない |

課題管理の課題が無い仕事には、どの `tracker` でも `t-<短い名>` の鍵を付ける（記録は書かれない）。

### 環境の級

`guard` には、その環境を変えると誰に響くかを書く。条件を満たさない命令は、門が実行の前に止める（[担当のあいだの決まり](/protocol/#門)）。

| `guard` | 響く先 | 変えてよい担当 | 先に要ること |
|---|---|---|---|
| `free` | 自分だけ | どの担当も | 無し |
| `tpm` | 並べて動いているほかの担当 | DevOps Engineer 担当だけ | TPM 担当に相談 |
| `pm` | ほかの人・ほかのチーム | DevOps Engineer 担当だけ | Product Manager の承認（TPM 担当が `tpm infra approve <環境> --minutes <分>` で門を開ける） |

`match` は命令の字との一致で見る。広すぎると読むだけの命令も止まり、狭すぎるとすり抜けるので、その環境を変える命令の頭（`aws `・`ssh staging` など）を書く。

## Dependabot の設定

Dependabot の skill を使う project では、`.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` を書き、次の 2 つを置く。`/tpm` の起動では Dependabot の PR を見ない。Product Manager が言ったときに TPM 担当が `/dependabot-triage` を呼ぶ。skill セットを書かなければ `/dependabot-triage` は使えない。skill セットを書いても 2 つが無いと `/dependabot-triage` と `/sustaining-engineer` は止まる。

### `.claude/dependabot/config.json`

`/dependabot-triage` と `/sustaining-engineer` はこの表を読み、欄を `config.<欄>` と書く（表と skill の欄の揃いは `docs-site/scripts/check-refs.mjs` が見る）。

| 欄 | 中身 | 例 |
|---|---|---|
| `owner` | GitHub の owner | `"example-org"` |
| `repos` | 対象の repo の名前の配列（fork などは入れない） | `["app", "lib"]` |
| `cwd` | Sustaining Engineer 担当を起こす folder（無ければ使う側の project の folder） | `"/path/to/workspace"` |
| `maxConcurrent` | 同時に動かす Sustaining Engineer 担当の数 | `3` |
| `hours` | 依存の version の公開から何時間たったら merge を検討するか | `72` |
| `model` | Sustaining Engineer 担当の model | `"claude-opus-5-5"` |
| `effort` | Sustaining Engineer 担当の effort | `"medium"` |
| `permissionMode` | Sustaining Engineer 担当の `--permission-mode` | `"bypassPermissions"` |
| `mergeMethod` | `gh pr merge` の方法 | `"squash"` |
| `rebaseWaitMinutes` | `@dependabot rebase` の応じた印 👍 を待つ分 | `20` |

### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。
