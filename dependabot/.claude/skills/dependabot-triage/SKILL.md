---
name: dependabot-triage
description: TPM 役が Dependabot の PR を集め、依存の版の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 役（/sustaining-engineer）を起こす。merge と workspace を閉じるのも TPM 役。引数 `一覧だけ` なら判定の表を出すだけで誰も起こさない。設定は使う側の .claude/dependabot/ から読む。
---

# Dependabot の PR の振り分け（TPM 役が呼ぶ）

呼ぶのは **Technical Program Manager 担当の Claude Code（TPM 役）** です。引数: `$ARGUMENTS`

- `一覧だけ`: 1・2 だけをして表を出し、誰も起こさない。
- `上限=<n>`: 同時に動かす Sustaining Engineer 役の数（既定は `config.maxConcurrent`）。
- 何も無ければ 1〜3 をして、4・5 は報告が来たら行う。

## 0. 設定を読む（最初に必ず）

- `${CLAUDE_SKILL_DIR}/../../../../core/.claude/skills/_shared/protocol.md`（役のあいだの決まり。知らせの送り方・頭・サイドバー）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/config.json`（欄は repo の README の表。以下 `config.<欄>` と書く）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/rules.md`（この project の決まり。**この skill の手順より先に従う**）

無ければ「この project には `.claude/dependabot/` の設定が無い」と言って止まる。

決まり:

- 対象は `config.owner` の `config.repos` の repo だけ。
- 時間（`config.hours`・既定 72）は **依存の版の公開から** 数える。group の PR は中のいちばん新しい版の公開から。版は PR の差分から読み、依存の依存も数える。
- 届かない PR は、Sustaining Engineer 役を起こさず、表に「いつ対象になるか」を出して次の回に回す。
- merge は TPM 役の権限で決める。workspace は、merge と【終わり】の報告を受け取った後に TPM 役が閉じる。

## 1. 集める

```sh
gh search prs --author app/dependabot --state open --owner <config.owner> --limit 100 \
  --json repository,number,title,createdAt,url
```

`config.repos` に無い repo の PR は捨てる。

## 2. 判定する

PR ごとに:

```sh
node "${CLAUDE_SKILL_DIR}/../_shared/release-age.mjs" <config.owner>/<repo> <PR> --hours <config.hours>
```

終了コード 0 = 対象・10 = まだ・20 = 判定できない・1 = 道具の誤り。CI は `gh pr checks <PR> --repo <config.owner>/<repo> --json name,bucket` で見て、`bucket` が `fail` の check の **名前** も拾う。

表を出す。列は次のとおり（題は長いので出さない）:

| 列 | 中身 |
|---|---|
| repo#PR | |
| 種類 | npm・github-actions・docker など |
| 公開から | いちばん新しい版の公開から今までの時間（eligibleAt − `config.hours` から計算） |
| eligibleAt | |
| CI | pass・fail・skipping の数 |
| 赤の check | fail の check の名前（audit だけの赤か、試験や build の赤かを見分ける） |
| 判定 | 対象・まだ・判定できない（null の依存の名前を添える）。`depsSource` が `commit-message` なら書き添える |

`一覧だけ` ならここで終わる。

## 3. 起こす

「対象」の PR を次の順に並べ、いま動いている Sustaining Engineer 役（`cmux workspace list` の題が `Sustaining Engineer ` で始まる workspace）と合わせて上限に届くまで、1 本ずつ起こす。上限に届いたら、残りは表に「待ち」と書いて、誰かが終わるのを待つ。

1. CI が全部緑の PR（直しが無く、早く閉じられる）を先に。
2. 次に、赤が試験や build の PR（直しが要る）。
3. 赤が audit だけの PR は最後に（勧告が直るまで緑にならないことが多い。同じ勧告の課題が `rules.md` にあれば、その番号を添えて起こす）。
4. 同じ組の中は eligibleAt の古い順。
5. 同じ repo の PR は 1 本ずつ（lockfile がぶつかる）。2 本目は 1 本目の merge の後に起こす。

**この skills の repo の root** を先に求める（Sustaining Engineer 役にも同じ skill を読ませるため）:

```sh
realpath "${CLAUDE_SKILL_DIR}/../../../.."
```

起こす 1 行（`<root>` は上の出力・`<cwd>` は `config.cwd`、無ければ `${CLAUDE_PROJECT_DIR}`）:

```sh
cmux workspace create --name "Sustaining Engineer <repo>#<PR>" --cwd <cwd> \
  --command 'claude --model <config.model> --effort <config.effort> --permission-mode <config.permissionMode> --add-dir <root>/core <root>/dependabot -- "/sustaining-engineer <repo>#<PR> tpm=<自分の workspace>"'
```

- **`--add-dir <root>/core <root>/dependabot` の後の `--` を落とさない。** 2 つの束を両方足す（protocol.md は core の束、`/sustaining-engineer` は dependabot の束にある）。 `--add-dir` は後ろの語もまとめて folder として読むので、`--` が無いと `/sustaining-engineer …` が依頼として渡らない。
- 自分の workspace は `cmux identify` の caller の `workspace_ref`。
- 起動の命令は 1,024 バイトを超えると黙って実行されない。上の形を延ばさない。
- **起こした後 90 秒の間に、`cmux sidebar-state --workspace <新しい workspace>` に `wait=作業中: …` の行が出たかを見る**（`/sustaining-engineer` の最初の手が `wait` を出す。題は起こすときに `--name` で付けてあるので、題では見分けられない）。出なければ `cmux read-screen --workspace <新しい workspace>` で画面を読む:
  - `Adding a new directory` や `trust` のダイアログ: `<root>` が信頼されていない（この repo は別の git の repo なので、信頼済みの folder の下に置いても信頼は及ばない）。**Yes は押さずに**その workspace を `close --force` し、`<root>` で 1 度 Claude Code を対話で起こして信頼するよう Product Manager に頼む（README の「信頼のダイアログ」）。
  - `Unknown command: /sustaining-engineer`: 旗か `<root>` の誤り。`close --force` して、命令を直して 1 度だけ起こし直す。2 回目も `wait` が出なければ Product Manager に知らせる。
- ほかの作業と順番がぶつかるとき（`rules.md` に書いてある物）は、起こすのを遅らせてよい。

## 4. 受ける

Sustaining Engineer 役から届く知らせ:

| 頭 | すること |
|---|---|
| 【merge の依頼】 | CI が緑か（`gh pr checks`）、`release-age.mjs` がまだ 0 か、差分が依頼のとおりかを自分で見てから `gh pr merge <PR> --repo <config.owner>/<repo> --<config.mergeMethod>`（repo の作法が違えばそれに従う）。merge の commit を返す。 |
| 【相談(TPM)】 | 答える。Product Manager の判断が要るなら、Product Manager に聞いてから答える。 |
| 【PM への依頼】 | URL の Artifact を自分の workspace で開き（`cmux open <URL> --workspace <自分の workspace>`）、Product Manager に見せる。答えを【PM の回答】で返す。 |
| 【まだ】 | 時間の【まだ】なら表の「待ち」に戻し、その workspace は 5 と同じに閉じる。`rebase に … 分応じない` の【まだ】なら、もう一度待たせるか、worktree で `origin/main` を merge させるかを決めて返す。 |
| 【作り直し】 | group の PR が閉じて新しい番号で作り直された。表の行を新しい番号に替え、同じ Sustaining Engineer 役に新しい番号で続けさせる（workspace の題も `Sustaining Engineer <repo>#<新>` に替えさせる）。判定は変わらない。 |
| 【終わり】 | 5 へ。 |

返事を送った後は、届いたかを見る（protocol.md の「知らせの送り方」）。

### `@dependabot rebase` の注意（TPM 役が知っておくこと）

Sustaining Engineer 役の手順（`${CLAUDE_SKILL_DIR}/../sustaining-engineer/SKILL.md` の 4a）と同じ要点。

- 応じた印は 👍。時間は決まっていない（実測で 20 分無反応のことがある）。Sustaining Engineer 役は `config.rebaseWaitMinutes` 分待って越えたら【まだ】か【相談(TPM)】を送ってくる。
- group の PR は閉じて新しい番号で作り直されることがある。判定は変わらないので、**新しい番号で引き継ぐ**（【作り直し】）。
- rebase で audit がいまの勧告の DB で流れ直し、緑の PR が赤になることがある。新しい勧告で audit が赤の間は、衝突していない PR を rebase させない。
- 人が commit を足した PR は Dependabot がもう rebase しない（`[dependabot skip]` の印の commit なら上書きされる）。その PR では rebase を打たせず、worktree で `origin/main` を merge して push させる（force push はしない）。
- 衝突は Dependabot が頼まなくても自分で rebase する。まず数分待たせる。
- merge されないまま 30 日たった PR は、Dependabot がもう rebase しない（公式）。

## 5. 閉じる

【終わり】（か【まだ】）を受け取ったら:

```sh
cmux workspace close <その workspace> --force
```

中で Claude Code が動いているので `--force` が要る（無いと `confirmation_required` で断られる）。閉じた後、表の「待ち」に対象の PR があれば 3 に戻る。

## 終わったら

その回の結果（merge した PR・待ちの PR と eligibleAt・判定できない PR・閉じた workspace）を Product Manager に短く伝える。
