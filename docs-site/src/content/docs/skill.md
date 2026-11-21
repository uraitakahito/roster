---
title: skill
description: skill セット（--add-dir の先）と、skill ごとの起こす人・担当・すること
---

## `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | 入るとき | skill |
|---|---|---|
| core | いつも（`tpm start` の 1 行と、担当を起こす `tpm assign`・`tpm audit start` が `--add-dir` で渡す） | `/tpm`・`/software-engineer`・`/devops-engineer`・`/audit`・`_shared/protocol.md`・`_shared/audit-charter.md`・`_shared/audit.md` |
| dependabot | 起こす folder の `.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` と書いたとき（[設定](/configuration/)）。`tpm assign` は、設定に書いた skill セットを起こす担当にも渡す | `/dependabot-triage`・`/sustaining-engineer` |

skill セット `<名前>` の skill は `skill-sets/<名前>/.claude/skills/` に置く。skill セットは `skill-sets/` の下に兄弟の folder で置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer` | TPM（`tpm assign <Key> --role software-engineer`） | Software Engineer | 課題 1 つを受け持つ。`tpm hello` で依頼書の URL を受け取り、調査・提案・計画・実装・テストを worktree で進め、成果をページ（置き場の HTML）と PR で出す。TPM 担当が【dismiss】を送るまで、同じ課題の続きを同じ担当が受ける |
| `/devops-engineer` | TPM（`tpm assign devops --role devops-engineer`） | DevOps Engineer | project の設定に書いた環境のビルド・デプロイ・整備と、ページの置き場（環境 `pagetray`）を起こして保つこと。共有の環境を変える前に、環境ごとの手続きに従って、TPM 担当への相談か Product Manager の承認を取る |
| `/audit` | Product Manager（`tpm audit start` で `Audit` の席を起こし、その席で `/audit`・`/audit <件の番号…>` を呼ぶ） | Auditor | 担当の仕組み（`tpm`・skill・決まり・ページの置き場）を証拠で調べ、指摘と勧告を Product Manager へじかに報告する。台帳の出来事の見直し・原因の調べ・追いかけをする。TPM 担当の回し方も見る。直さない・決めない（監査の規程は `_shared/audit-charter.md`）。運びは [運用](/operations/#監査auditor-の席) |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と居場所を閉じるのも TPM 担当。`dry-run` で表だけ |
| `/sustaining-engineer` | TPM（`tpm assign "<repo>#<PR>" --role sustaining-engineer`） | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |
