---
name: dependabot-triage
description: Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当（/sustaining-engineer）を起こす。merge と居場所を閉じるのも TPM 担当。引数 `dry-run` なら判定の表を出すだけで誰も起こさない。設定は使う側の .claude/dependabot/ から読む。
when_to_use: TPM 担当（/tpm）の居場所で、Product Manager が Dependabot の PR を見る・振り分ける・まとめて片付けると言ったときに呼ぶ（例「Dependabot の PR を見て」「依存の更新の PR を振り分けて」「Dependabot を dry-run で」）。呼ばないのは、/tpm の起動のとき、Software Engineer・DevOps Engineer・Sustaining Engineer 担当の居場所（PR 1 本の直しは /sustaining-engineer の仕事）、Dependabot の設定や仕組みを聞かれただけのとき。
---

# Dependabot の PR の振り分け（TPM 担当が呼ぶ）

呼ぶのは **Technical Program Manager 担当の Claude Code（TPM 担当）** で、Product Manager が言ったときです（`/tpm` の起動では呼ばない）。引数: `$ARGUMENTS`

- `dry-run`: 1・2 だけをして表を出し、誰も起こさない。
- `max=<n>`: 同時に動かす Sustaining Engineer 担当の数（既定は `config.maxConcurrent`）。
- 何も無ければ 1〜3 をして、4・5 は報告が来たら行う。

## 0. 設定を読む（最初に必ず）

- `${CLAUDE_SKILL_DIR}/../../../../core/.claude/skills/_shared/protocol.md`（担当のあいだの決まり。連絡の仕方・見出し・状態）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/config.jsonc`（欄は `${CLAUDE_SKILL_DIR}/../../../../../docs-site/src/content/docs/configuration.md` の「`.claude/dependabot/config.jsonc`」の表。以下 `config.<欄>` と書く）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/rules.md`（この project の決まり。**この skill の手順より先に従う**）

無ければ「この project には `.claude/dependabot/` の設定が無い」と言って止まる。古い名前の `.claude/dependabot/config.json` があれば、読まずに止まる。`config.jsonc` が無ければ「`config.jsonc` に名前を替えてください（中身はそのままで読めます）。project の folder で `mv .claude/dependabot/config.json .claude/dependabot/config.jsonc`」、両方あれば「`config.json` を消してください（要る中身は先に `config.jsonc` へ移す）」と言う。

決まり:

- 対象は `config.owner` の `config.repos` の repo だけ。
- 時間（`config.hours`・既定 72）は **依存の version の公開から** 数える。group の PR は中のいちばん新しい version の公開から。version は PR の差分から読み、依存の依存も数える。
- 届かない PR は、Sustaining Engineer 担当を起こさず、表に「いつ対象になるか」を出して次の回に回す。
- merge は TPM 担当の権限で決める。居場所は、merge と【end】の報告を受け取った後に TPM 担当が閉じる。

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

表を出す。列は次のとおり（題は長いので出さない）:

| 列 | 中身 |
|---|---|
| repo#PR | |
| 種類 | npm・github-actions・docker など |
| 公開から | いちばん新しい version の公開から今までの時間（eligibleAt − `config.hours` から計算） |
| eligibleAt | |
| CI | pass・fail・skipping の数 |
| 赤の check | fail の check の名前（audit だけの赤か、試験や build の赤かを見分ける） |
| 判定 | 対象・まだ・判定できない（null の依存の名前を添える）。`depsSource` が `commit-message` なら書き添える |

`dry-run` ならここで終わる。

## 3. 起こす

「対象」の PR を次の順に並べ、いま動いている Sustaining Engineer 担当（`tpm roles` の名簿で Sustaining Engineer の行）と合わせて上限に届くまで、1 本ずつ起こす。上限に届いたら、残りは表に「待ち」と書いて、誰かが終わるのを待つ。

1. CI が全部緑の PR（直しが無く、早く閉じられる）を先に。
2. 次に、赤が試験や build の PR（直しが要る）。
3. 赤が audit だけの PR は最後に（勧告が直るまで緑にならないことが多い。同じ勧告の課題が `rules.md` にあれば、その番号を添えて起こす）。
4. 同じ組の中は eligibleAt の古い順。
5. 同じ repo の PR は 1 本ずつ（lockfile がぶつかる）。2 本目は 1 本目の merge の後に起こす。

起こす 1 行（`<cwd>` は `config.cwd`、無ければ `${CLAUDE_PROJECT_DIR}`）。Key は `<repo>#<PR>`（`#` があるので引用する）:

```sh
tpm assign "<repo>#<PR>" --role sustaining-engineer --cwd <cwd> \
  --model <config.model> --effort <config.effort> --permission-mode <config.permissionMode>
```

- `config.model`・`config.effort`・`config.permissionMode` は、書いてある物の旗だけを付ける（無い欄の旗は付けない。`tpm assign` が環境変数 `TPM_MODEL` などかコードの既定で決める）。

- skill セットは、起こした folder の `.claude/roles/config.jsonc` の `skill-sets` に書いた物が足される（core と dependabot。protocol.md は core の skill セット、`/sustaining-engineer` は dependabot の skill セットにある）。
- `tpm assign` は、新しい担当が名乗るまで 90 秒待ち、結果を返す:
  - 「信頼のダイアログで止まっていたので閉じた」: この roster の repo が信頼されていない（別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない）。出た folder で 1 度 Claude Code を対話で起こして信頼するよう Product Manager に頼む（`${CLAUDE_SKILL_DIR}/../../../../../docs-site/src/content/docs/getting-started.md` の「信頼のダイアログ」）。
  - 「Unknown command」: `skill-sets` に `"dependabot"` が書かれていない。閉じてある。Product Manager に知らせる。
- ほかの作業と順番がぶつかるとき（`rules.md` に書いてある物）は、起こすのを遅らせてよい。

## 4. 受ける

Sustaining Engineer 担当から届くメッセージ:

| 見出し | すること |
|---|---|
| 【merge-request】 | CI が緑か（`gh pr checks`）、`release-age.ts` がまだ 0 か、差分が依頼のとおりかを自分で見てから `gh pr merge <PR> --repo <config.owner>/<repo> --<config.mergeMethod>`（repo の作法が違えばそれに従う）。merge の commit を `tpm notify "<repo>#<PR>" "merge した: <commit>"` で返す。 |
| 【ask-tpm】 | 答える（`tpm notify`）。Product Manager の判断が要るなら、Product Manager に聞いてから答える。 |
| 【ask-pm】 | Product Manager に、確認のページの URL と項目を伝える（その場で開いて見せる時だけ `tpm show <URL>`）。答えを `tpm answer` で返す。 |
| 【not-yet】 | 時間の【not-yet】なら表の「待ち」に戻し、その担当は 5 と同じに閉じる。`rebase に … 分応じない` の【not-yet】なら、もう一度待たせるか、worktree で `origin/main` を merge させるかを決めて返す。 |
| 【recreated】 | group の PR が閉じて新しい番号で作り直された。表の行を新しい番号に替え、同じ Sustaining Engineer 担当に新しい番号で続けさせる（居場所の題は担当が替える。名簿の Key は元の `<repo>#<旧>` のまま）。判定は変わらない。 |
| 【end】 | 5 へ。 |

命令が「まだ届いていない」と返しても送り直さない（protocol.md の「連絡の仕方」）。

### `@dependabot rebase` の注意（TPM 担当が知っておくこと）

Sustaining Engineer 担当の手順（`${CLAUDE_SKILL_DIR}/../sustaining-engineer/SKILL.md` の 3a）と同じ要点。

- 応じた印は 👍。時間は決まっていない（実測で 20 分無反応のことがある）。Sustaining Engineer 担当は `config.rebaseWaitMinutes` 分待って越えたら【not-yet】か【ask-tpm】を送ってくる。
- group の PR は閉じて新しい番号で作り直されることがある。判定は変わらないので、**新しい番号で引き継ぐ**（【recreated】）。
- rebase で audit がいまの勧告の DB で流れ直し、緑の PR が赤になることがある。新しい勧告で audit が赤の間は、衝突していない PR を rebase させない。
- 人が commit を足した PR は Dependabot がもう rebase しない（`[dependabot skip]` の印の commit なら上書きされる）。その PR では rebase を打たせず、worktree で `origin/main` を merge して push させる（force push はしない）。
- 衝突は Dependabot が頼まなくても自分で rebase する。まず数分待たせる。
- merge されないまま 30 日たった PR は、Dependabot がもう rebase しない（公式）。

## 5. 閉じる

【end】（か【not-yet】）を受け取ったら:

```sh
tpm close "<repo>#<PR>"
```

Key は起こしたときの番号（【recreated】の後も元の番号）。閉じた後、表の「待ち」に対象の PR があれば 3 に戻る。

## 終わったら

その回の結果（merge した PR・待ちの PR と eligibleAt・判定できない PR・閉じた担当）を Product Manager に短く伝える。
