---
title: skill
description: skill セット（--add-dir の先）と、skill ごとの起こす人・担当・すること
---

## `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | folder | skill |
|---|---|---|
| core | `skill-sets/core/.claude/skills/` | `/tpm`・`/software-engineer`・`/devops-engineer`・`_shared/protocol.md`・`_shared/jira.md` |
| dependabot | `skill-sets/dependabot/.claude/skills/` | `/dependabot-triage`・`/sustaining-engineer` |

core はいつも足す。追加の skill セットは、起こす folder の `.claude/roles/config.json` の `skill-sets` に書いたときだけ足す（[設定](/configuration/)）。skill セットは `skill-sets/` の下に兄弟の folder で置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer` `tpm=<surface>` `brief=<URL>` `[jira=<課題>]` | TPM | Software Engineer | 課題 1 つを受け持つ。依頼書（Artifact）を読み、調査・提案・計画・実装・テストを worktree で進め、成果を Artifact と PR で出す |
| `/devops-engineer` `tpm=<surface>` `[brief=<URL>]` `[jira=<課題>]` | TPM | DevOps Engineer | Apple Container と Windmill のビルド・デプロイ・環境の整備。課題間のconflict等は TPM 担当に相談する |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と workspace を閉じるのも TPM 担当。`dry-run` で表だけ |
| `/sustaining-engineer` `<repo>#<PR>` `tpm=<workspace>` | TPM | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |
