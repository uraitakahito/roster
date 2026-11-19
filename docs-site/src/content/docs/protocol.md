---
title: 担当のあいだの決まり
description: 担当どうしの連絡の決まりは protocol.md の 1 か所にある。依頼書のひな形の場所と、見出しの流れ
---

「連絡の仕方と見出し・サイドバーの `model` と `wait`・Product Manager への確かめ方・文書の食い違い・共有の環境・終わり方」は `core/.claude/skills/_shared/protocol.md` の 1 か所に書き、どの担当もそれを読む。決まりの本文は、このページには写さない（skill が読む原本は `protocol.md`）。

TPM 担当が書く依頼書には、その課題だけのことを書く（ひな形は `core/.claude/skills/tpm/brief-template.md`）。

## 見出しの流れ

担当どうしは、`cmux agent message` で見出しの付いた知らせを送り合う。Software Engineer 担当の 1 つの課題では、おおよそ次の順に流れる（見出しの一覧と中身は `protocol.md`）。

```mermaid
sequenceDiagram
  participant PM as Product Manager
  participant TPM as TPM 担当
  participant SE as Software Engineer 担当
  PM->>TPM: 課題を頼む
  TPM->>SE: /software-engineer（依頼書の URL）
  opt 迷ったとき・決めてほしいとき
    SE->>TPM: 【相談(TPM)】【PM への確認】【PM への依頼】
    TPM->>PM: 確かめる
    TPM->>SE: 【PM の回答】
  end
  SE->>TPM: 【merge 済み】（PR ごと）
  SE->>TPM: 【完成】（成果の Artifact）
  SE->>TPM: 【終わり】
  TPM->>PM: 報告する
  TPM->>TPM: 担当の workspace を閉じる
```
