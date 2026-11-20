---
title: skills
description: Product Manager（人）を、TPM・Software Engineer・DevOps Engineer・Sustaining Engineer の各担当（Claude Code）が助けるための skill の一式と、担当のあいだの決まりを受け持つ tpm の CLI
---

skills は、Product Manager（人）を、Claude Code の各担当が助けるための skill の一式です。担当どうしのやりとり（担当を起こす・メッセージを送る・課題に記録する・共有の環境を守る）は `tpm` の CLI が受け持ち、課題管理（Jira・GitHub の Issue）と連携（cmux）の道具は project ごとに設定で選びます。

## skill で呼び出される担当者

Product Manager が TPM 担当を起こし、TPM 担当が課題ごとにほかの担当を起こします。

```mermaid
flowchart LR
  PM["Product Manager（人）"] -->|"/tpm"| TPM["Technical Program Manager"]
  TPM -->|"tpm assign → /software-engineer"| SE["Software Engineer"]
  TPM -->|"tpm assign → /devops-engineer"| DE["DevOps Engineer"]
  TPM -->|"/dependabot-triage → /sustaining-engineer"| SU["Sustaining Engineer"]
```

## 読む順

- [はじめる](/getting-started/): install と、TPM 担当を起こす 1 行
- [skill](/skill/): skill セットと、skill ごとの起こす人・すること
- [担当のあいだの決まり](/protocol/): 担当どうしの連絡の決まりがどこにあるかと、層の分け方
- [設定](/configuration/): 使う側の project に置く設定（課題管理・連携・インフラの環境）
- [運用](/operations/): repo を移す手順
- [開発](/development/): 試験・判定の道具・この docs の直し方
