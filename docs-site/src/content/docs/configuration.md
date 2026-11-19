---
title: 設定
description: 使う側の project に置く .claude/roles/config.json と、Dependabot の skill の設定
---

## `.claude/roles/config.json`（任意）

TPM 担当を起こした folder に置くと、追加の skill セットと、TPM 担当が起こす担当の既定を替えられる。

| 欄 | 中身 | 無いとき |
|---|---|---|
| `skill-sets` | core のほかに加える、追加の skill セットの名前の配列（`cli/bin/tpm` が読む） | core だけ |
| `software-engineer`・`devops-engineer` | 起こす担当の `model`・`effort`・`permissionMode`（`/tpm` が読む） | `/tpm` の表の既定（Software Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、どちらも `bypassPermissions`） |

```json
{ "skill-sets": ["dependabot"],
  "software-engineer": { "model": "claude-opus-5-5", "effort": "high", "permissionMode": "bypassPermissions" },
  "devops-engineer": { "model": "claude-opus-5-5", "effort": "low", "permissionMode": "bypassPermissions" } }
```

## Dependabot の設定

Dependabot の skill を使う project では、`.claude/roles/config.json` の `skill-sets` に `"dependabot"` を書き、次の 2 つを置く。`/tpm` の起動では Dependabot の PR を見ない。Product Manager が言ったときに TPM 担当が `/dependabot-triage` を呼ぶ。skill セットを書かなければ `/dependabot-triage` は使えない。skill セットを書いても 2 つが無いと `/dependabot-triage` と `/sustaining-engineer` は止まる。

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
| `modelLabel` | サイドバーに出す字 | `"Opus 5.5 · medium"` |
| `permissionMode` | Sustaining Engineer 担当の `--permission-mode` | `"bypassPermissions"` |
| `mergeMethod` | `gh pr merge` の方法 | `"squash"` |
| `rebaseWaitMinutes` | `@dependabot rebase` の応じた印 👍 を待つ分 | `20` |

### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。
