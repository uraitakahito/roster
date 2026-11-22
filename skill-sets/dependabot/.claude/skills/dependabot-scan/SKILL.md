---
name: dependabot-scan
description: Dependabot の PR を集め、依存の version の公開からの時間と CI を判定して、表を 1 つ返す。誰も起こさず、知らせも送らない。
when_to_use: /dependabot-triage の「1. 表を作る」から、Skill tool で呼ぶ。呼ばないのは、Product Manager が Dependabot の PR を見ると言っただけのとき（まず /dependabot-triage を呼ぶ）、TPM 担当でない担当の居場所。
user-invocable: false
context: fork
agent: general-purpose
background: false
---

# Dependabot の PR の表を作る（/dependabot-triage が呼ぶ）

あなたは、TPM 担当の `/dependabot-triage` に呼ばれた助手です。Dependabot の PR を集めて判定し、**表を 1 つ返すだけ**です。会話の履歴と CLAUDE.md は見えないので、要ることはすべてここと、下で読む file にあります。

- **誰も起こさない。知らせを送らない。** `tpm` の命令は打たない（あなたの `tpm` は TPM 担当として動くので、打つと TPM 担当の名で知らせや状態が変わる）。起こす・知らせるのは、表を受け取った TPM 担当。
- PR には書き込まない。`gh` は読む命令だけを打つ（`gh pr comment`・`gh pr merge` などは打たない）。

## 0. 設定を読む（最初に必ず）

- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/config.jsonc`（欄は `${CLAUDE_SKILL_DIR}/../../../../../docs-site/src/content/docs/configuration.md` の「`.claude/dependabot/config.jsonc`」の表。以下 `config.<欄>` と書く）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/rules.md`（この project の決まり。**この skill の手順より先に従う**）

設定が読めなければ、表を作らず、`止まる: ` を頭に付けた 1 行だけを返す（訳は次のとおり。TPM 担当がそのまま Product Manager に伝える）:

- 設定の folder が無い: `止まる: この project には .claude/dependabot/ の設定が無い`
- 古い名前の `config.json` だけがある（読まない）: `止まる: config.jsonc に名前を替えてください（中身はそのままで読めます）。project の folder で mv .claude/dependabot/config.json .claude/dependabot/config.jsonc`
- `config.json` と `config.jsonc` の両方がある: `止まる: config.json を消してください（要る中身は先に config.jsonc へ移す）`

決まり:

- 対象は `config.owner` の `config.repos` の repo だけ。
- 時間（`config.hours`・既定 72）は **依存の version の公開から** 数える。group の PR は中のいちばん新しい version の公開から。version は PR の差分から読み、依存の依存も数える。
- 届かない PR も表に載せ、「いつ対象になるか」（eligibleAt）を出す（次の回に回すのは TPM 担当）。

## 1. 集める

```sh
args=()
for r in <config.repos>; do args+=(--repo "<config.owner>/$r"); done
gh search prs --author app/dependabot --state open "${args[@]}" --limit 100 \
  --json repository,number,title,createdAt,url
```

- 配列で組む（文字列にまとめると zsh が 1 語で渡し、`unknown flag` になる）。
- 100 本返ったら、表の下に「上限の 100 本に届いた。残りは次の回」と書く。

## 2. 判定する

PR ごとに:

```sh
node "${CLAUDE_SKILL_DIR}/../../../../../cli/src/release-age.ts" <config.owner>/<repo> <PR> --hours <config.hours>
```

終了コード 0 = 対象・10 = まだ・20 = 判定できない・1 = 道具の誤り。CI は `gh pr checks <PR> --repo <config.owner>/<repo> --json name,bucket` で見て、`bucket` が `fail` の check の **名前** も拾う。

表を作る。列は次のとおり（題は長いので出さない）:

| 列 | 中身 |
|---|---|
| repo#PR | |
| 種類 | npm・github-actions・docker など |
| 公開から | いちばん新しい version の公開から今までの時間（eligibleAt − `config.hours` から計算） |
| eligibleAt | |
| CI | pass・fail・skipping の数 |
| 赤の check | fail の check の名前（audit だけの赤か、試験や build の赤かを見分ける） |
| 判定 | 対象・まだ・判定できない（null の依存の名前を添える）。`depsSource` が `commit-message` なら書き添える |

## 3. 返す

次の形だけを返す。前置きや、命令の出力は付けない。

1. 1 行目: `dependabot-scan: <n> 本（対象 <a>・まだ <b>・判定できない <c>）`。n は表の行の数。
2. 2 の表。
3. 注（あれば）: 上限の 100 本に届いた・判定できない PR の null の依存の名・`depsSource` が `commit-message` の PR。
