# roster

Product Manager（人）を、TPM・Software Engineer・DevOps Engineer・Sustaining Engineer・Auditor の
各担当（Claude Code）が助けるための skill の一式と、担当のあいだの決まりを受け持つ `tpm` の CLI。
課題管理（Jira・GitHub の Issue）と担当どうしの連携（cmux）は、project ごとに設定で選ぶ。

## ドキュメント

https://uraitakahito.github.io/roster/

## 起動

Node は `.node-version` の version を nodenv で入れ、pnpm は corepack で出す（[はじめる](https://uraitakahito.github.io/roster/getting-started/)）。

```sh
cd <roster の置き場所> && pnpm --dir cli install --frozen-lockfile
<roster の置き場所>/cli/bin/tpm start <作業する folder>   # 出た 1 行を写して打つ
```

model・effort・permission mode の既定は、環境変数 `TPM_MODEL`・`TPM_EFFORT`・`TPM_PERMISSION_MODE` で替えられる（shell の profile で export すると、TPM 担当にも起こす担当にも効く。[設定](https://uraitakahito.github.io/roster/configuration/#model-などの既定の環境変数任意)）。
