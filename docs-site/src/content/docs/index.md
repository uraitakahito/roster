---
title: skills
description: Product Manager（人）を、TPM・Software Engineer・DevOps Engineer・Sustaining Engineer の各担当（Claude Code）が cmux の上で助けるための skill の一式
---

skills は、Product Manager（人）を、Claude Code の各担当が cmux の上で助けるための skill の一式です。

## skill で呼び出される担当者

| 担当 | 人間か AI か |
|---|---|
| `Product Manager` | 人間 |
| `Technical Program Manager` | AI |
| `Software Engineer` | AI |
| `DevOps Engineer` | AI |
| `Sustaining Engineer` | AI |

```mermaid
flowchart LR
  PM["Product Manager（人）"] -->|"/tpm"| TPM["Technical Program Manager"]
  TPM -->|"/software-engineer"| SE["Software Engineer"]
  TPM -->|"/devops-engineer"| DE["DevOps Engineer"]
  TPM -->|"/sustaining-engineer"| SU["Sustaining Engineer"]
```

起動のしかた・skill・設定は、いまは repo の [README](https://github.com/uraitakahito/skills#readme) にあります。
