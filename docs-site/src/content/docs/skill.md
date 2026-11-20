---
title: skill
description: skill セット（--add-dir の先）と、skill ごとの起こす人・担当・すること
---

## `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | 入るとき | skill |
|---|---|---|
| core | いつも（`tpm start` の 1 行と、担当を起こす `tpm assign` が `--add-dir` で渡す） | `/tpm`・`/software-engineer`・`/devops-engineer`・`_shared/protocol.md` |
| dependabot | 起こす folder の `.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` と書いたとき（[設定](/configuration/)）。`tpm assign` は、設定に書いた skill セットを起こす担当にも渡す | `/dependabot-triage`・`/sustaining-engineer` |

skill セット `<名前>` の skill は `skill-sets/<名前>/.claude/skills/` に置く。skill セットは `skill-sets/` の下に兄弟の folder で置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer` | TPM（`tpm assign <鍵> --role software-engineer`） | Software Engineer | 課題 1 つを受け持つ。`tpm hello` で依頼書の URL を受け取り、調査・提案・計画・実装・テストを worktree で進め、成果を Artifact と PR で出す。TPM 担当が【dismiss】を送るまで、同じ課題の続きを同じ担当が受ける |
| `/devops-engineer` | TPM（`tpm assign devops --role devops-engineer`） | DevOps Engineer | project の設定に書いた環境のビルド・デプロイ・整備。共有の環境を変える前に、級に応じて TPM 担当への相談か Product Manager の承認を取る |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と居場所を閉じるのも TPM 担当。`dry-run` で表だけ |
| `/sustaining-engineer` | TPM（`tpm assign "<repo>#<PR>" --role sustaining-engineer`） | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |
