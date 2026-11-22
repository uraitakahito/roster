---
title: skill
description: skill セット（--add-dir の先）と、skill ごとの起こす人・担当・すること
---

## `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | 入るとき | skill |
|---|---|---|
| core | いつも（`tpm start` の 1 行と、担当を起こす `tpm assign`・`tpm audit start` が `--add-dir` で渡す） | `/tpm`・`/software-engineer`・`/devops-engineer`・`/staff-engineer`・`/audit`・`audit-evidence`・`_shared/protocol.md`・`_shared/audit-charter.md`・`_shared/audit.md`・`_shared/figures.md` |
| dependabot | 起こす folder の `.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` と書いたとき（[設定](/configuration/)）。`tpm assign` は、設定に書いた skill セットを起こす担当にも渡す | `/dependabot-triage`・`dependabot-scan`・`/sustaining-engineer` |

skill セット `<名前>` の skill は `skill-sets/<名前>/.claude/skills/` に置く。skill セットは `skill-sets/` の下に兄弟の folder で置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager（`tpm start` が出す 1 行を打つ。`/tpm` はその 1 行の最初の入力） | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer` | TPM（`tpm assign <Key> --role software-engineer`） | Software Engineer | 課題 1 つを受け持つ。`tpm hello` で依頼書の URL を受け取り、調査・提案・計画・実装・テストを worktree で進め、成果をページ（置き場の HTML）と PR で出す。TPM 担当が【dismiss】を送るまで、同じ課題の続きを同じ担当が受ける |
| `/devops-engineer` | TPM（`tpm assign devops --role devops-engineer`） | DevOps Engineer | project の設定に書いた環境のビルド・デプロイ・整備と、ページの置き場（環境 `pagetray`）を起こして保つこと。共有の環境を変える前に、環境ごとの手続きに従って、TPM 担当への相談か Product Manager の承認を取る |
| `/staff-engineer` | 課題の担当の `tpm ask review`（席が無ければ、命令が起こす。依頼書は、命令がレビューの頼みから作る。TPM 担当の `tpm assign <課題の Key> --role staff-engineer` は起こし直し） | Staff Engineer | 課題の担当が頼んだ計画・提案のページや PR を、書いた者から離れた目で見て、判定（よい・気になる所あり・直すべき・見られなかった）と指摘をレビューのページで、頼んだ担当へじかに返す（TPM 担当を通らない）。席は課題ごとに、課題の担当の隣に立つ。見て助言するだけで、直さない・決めない（読むだけの守りが掛かる）。受けるかは課題の担当が決める。運びは [運用](/operations/#レビューstaff-engineer-担当の席) |
| `/audit` | Product Manager（`tpm audit start` で `Audit` の席を起こし、その席で `/audit`・`/audit <件の番号…>` を呼ぶ） | Auditor | 担当の仕組み（`tpm`・skill・決まり・ページの置き場）を証拠で調べ、指摘と勧告を Product Manager へじかに報告する。台帳の出来事の見直し・原因の調べ・追いかけをする。TPM 担当の回し方も見る。直さない・決めない（監査の規程は `_shared/audit-charter.md`）。運びは [運用](/operations/#監査auditor-の席) |
| `audit-evidence` | `/audit`（「調べる」の段で、件ごとに Skill tool で呼ぶ。`user-invocable: false` なので / の一覧に出ない） | Auditor の居場所の助手（`context: fork`・`agent: Explore` の subagent） | 台帳の件 1 つについて、時系列のページと関わる記録を読み、事実と証拠の在り処と字を返す。原因・勧告・扱いは出さない。Auditor は指摘に使う証拠を自分で開いて確かめる |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と居場所を閉じるのも TPM 担当。`dry-run` で表だけ、`max=<n>` で同時に動かす Sustaining Engineer 担当の数 |
| `dependabot-scan` | `/dependabot-triage`（Skill tool で呼ぶ。`user-invocable: false` なので / の一覧に出ない） | TPM の居場所の助手（`context: fork` の subagent） | Dependabot の PR を集め、公開からの時間と CI を判定して、表を 1 つ返す。誰も起こさず、知らせも送らない。PR ごとの命令の出力が TPM 担当の会話に残らない |
| `/sustaining-engineer` | TPM（`tpm assign "<repo>#<PR>" --role sustaining-engineer`） | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |
