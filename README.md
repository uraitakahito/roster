# skills

Product Manager（人）を、TPM・Software Engineer・DevOps Engineer・Sustaining Engineer の
各担当（Claude Code）が cmux の上で助けるための skill の一式。

## ドキュメント

https://uraitakahito.github.io/skills/

## 起動

Node は `.node-version` の version を nodenv で入れ、pnpm は corepack で出す（[はじめる](https://uraitakahito.github.io/skills/getting-started/)）。

```sh
cd <skills の置き場所> && pnpm --dir cli install --frozen-lockfile
<skills の置き場所>/cli/bin/tpm <作業する folder>   # 出た 1 行を写して打つ
```
