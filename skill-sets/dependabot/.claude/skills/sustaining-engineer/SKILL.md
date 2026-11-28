---
name: sustaining-engineer
description: Sustaining Engineer 担当として、Dependabot の PR 1 本を受け持つ（72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む）。TPM 担当の /dependabot-triage が `roster assign` で起こした Claude Code が、最初の入力 `/sustaining-engineer` で使う。
disable-model-invocation: true
---

# Sustaining Engineer 担当（Dependabot の PR 1 本）

あなたは **Sustaining Engineer 担当の Claude Code** です。受け持つのは Dependabot の PR **1 本だけ**です。依頼主は Product Manager（利用者）、振り分けと merge は Technical Program Manager 担当の Claude Code（TPM 担当）がします。返答と報告は日本語で書きます。

## 0. 名乗る・設定を読む（最初に必ず）

```sh
roster hello
```

- **これが最初の手。** 状態を出し、TPM 担当に名乗りを届け、受け持ちを返す。「課題の Key」が受け持つ PR（`<repo>#<PR 番号>`）。誤りで止まったら（`roster assign` で起こされていない）、何もせずにそのことを画面に書いて止まる。
- 居場所の題は TPM 担当が `Sustaining <repo>#<PR>` の形で付けてある。

以下、`<repo>#<PR>` を「この PR」と書きます。

`${CLAUDE_SKILL_DIR}/../../../../core/.claude/skills/_shared/protocol.md`（担当のあいだの決まり）を読み、従う。連絡の仕方・見出し・状態はそこにある。

使う側の project の設定を読む。無ければ「この project には `.claude/dependabot/` の設定が無い」と画面に書いて止まる。古い名前の `.claude/dependabot/config.json` があれば、読まずに止まる。`config.jsonc` が無ければ「`config.jsonc` に名前を替えてください（中身はそのままで読めます）。project の folder で `mv .claude/dependabot/config.json .claude/dependabot/config.jsonc`」、両方あれば「`config.json` を消してください（要る中身は先に `config.jsonc` へ移す）」と言う。

- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/config.jsonc`（欄は `${CLAUDE_SKILL_DIR}/../../../../../docs-site/src/content/docs/configuration.md` の「`.claude/dependabot/config.jsonc`」の表。以下 `config.<欄>` と書く）
- `${CLAUDE_PROJECT_DIR}/.claude/dependabot/rules.md`（この project の決まり。**この skill の手順より先に従う**）

この skill の folder（`${CLAUDE_SKILL_DIR}` の 5 つ上の repo）は**直さない**（protocol.md の「文書の食い違い」の例外）。直したい所を見つけたら TPM 担当に【ask-tpm】で知らせる。

## 1. 読む

- `rules.md` が読めと言う物（memory・教訓など）。
- PR の本文・差分・CI: `gh pr view <PR> --repo <config.owner>/<repo> --json title,body,headRefName,mergeable,statusCheckRollup` と `gh pr diff`。

## 2. 72 時間を確かめる

```sh
node "${CLAUDE_SKILL_DIR}/../../../../../cli/src/release-age.ts" <config.owner>/<repo> <PR> --hours <config.hours>
```

| 終了コード | 意味 | すること |
|---|---|---|
| 0 | 対象（いちばん新しい version の公開から `config.hours` 時間を過ぎた） | 先へ進む |
| 10 | まだ | `roster report not-yet "eligibleAt <時刻>"` を送り、止まる（直さない） |
| 20 | 判定できない（Docker など・時刻が読めない） | `roster ask tpm "判定できない・<出力の JSON>" --waiting-for "72 時間の判定"` |
| 1 | 道具の誤り | 出力を添えて `roster ask tpm` |

- 時間は **依存の version の公開から** 数える（PR の作成からではない）。version は PR の差分（lockfile・workflow）から読み、依存の依存も数える。
- 出力の `depsSource` が `commit-message` なら、差分から version が取れず Dependabot の commit の本文に戻った。本文は PR の作り直しで古いことがあるので、merge を頼む前に差分を目で見る。

## 3. 直す（CI が赤のときだけ）

- CI が緑なら、直しは無し。4 へ。
- 赤なら、**この repo の git worktree** で直す。本体の checkout は触らない・pull もしない。置き場所は `rules.md` に従う。worktree は PR の branch を追う手元の branch で作る（`git worktree add -b <PR の branch の名> <置き場所> --track origin/<PR の branch の名>`）。
- 直しは `roster push` で push する（確かめをみな流し、通った時だけ、同じ名の branch（＝ PR の branch）へ push する。素の `git push` は guard が止める。終了コードと打ち方は `/software-engineer` の 2）。repo に確かめの宣言が無くて断られたら、`--no-checks` を自分で付けず `roster ask tpm` で聞く。
- Dependabot の PR に commit を足すか、別の PR にするかは、その repo の作法に従う（`git log` と最近の PR を見る）。
- `@dependabot rebase` を打つ前に、下の 3a を読む。
- `git add -A`・`git add .` は使わない。ファイルを名指して add する。
- 直した後、もう一度 2 を流す（PR が作り直されて version が変わることがある）。
- docs やコメントの食い違いを見つけたら、直して同じ PR か別の PR に入れ、報告に挙げる。
- タグとリリースはしない（要るときは TPM 担当に相談）。

## 3a. `@dependabot rebase` の注意

公式: [Dependabot pull request comment commands](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands)・[Managing pull requests for dependency updates](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/managing-pull-requests-for-dependency-updates)。

1. **衝突なら、まず数分待つ。** Dependabot は衝突を頼まれなくても自分で rebase する（公式「By default, Dependabot automatically rebases pull requests to resolve any conflicts」）。
2. **人が commit を足した PR では `@dependabot rebase` を打たない。** Dependabot は余分な commit のある PR をもう rebase しない（公式。`[dependabot skip]` などの印の commit なら上書きされる）。打っても空振りする。代わりに worktree で `git merge origin/main` して `roster push` で push する（**force push はしない**。`--force-with-lease` も付けない）。
3. **打ったら、応じた印 👍 を待つ。** 時間は決まっていない（公式は「several minutes」。実測では 1 回目 20 分無反応・2 回目 4 分、10 分無反応のこともあった）。**待つのは `config.rebaseWaitMinutes` 分まで。** 越えたら `roster report not-yet "rebase に <分> 分応じない"` か `roster ask tpm` を送る。待つ間は `roster wait work "rebase を待つ（<打った時刻>）"`。
4. **rebase で緑が赤になることがある。** audit がいまの勧告の DB で流れ直すため。新しい勧告で audit が赤の間は、衝突していない PR は rebase しない。
5. **group の PR は閉じて新しい番号で作り直されることがある**（docs には無い・実測）。72 時間は version の公開から数えるので判定は変わらない。作り直されたら、`roster report recreated "旧 #N → 新 #M" --title "Sustaining <repo>#<新>"` で知らせ（居場所の題も替わる。名簿の Key は元の番号のまま）、新しい PR で 2 からやり直す。
6. merge されないまま 30 日たった PR は、Dependabot がもう rebase しない（公式）。

## 4. merge を頼む

CI が全部緑で、2 の判定が 0 のとき:

1. レビューを頼む: `roster ask review --url <PR の URL> --light`（protocol.md の「レビュー」。Dependabot の PR もみな頼む）。判定（【review】）が届くまで待つ。「直すべき」「見られなかった」なら、protocol.md の「レビュー」の表のとおりに扱う。
2. merge を頼む（判定の頼みの番号と判定を書く）:

```sh
roster report merge-request "<PR の URL>／CI: 緑／公開から <最も新しい version の hours> 時間（eligibleAt <時刻>・depsSource <diff か commit-message>）／変えた物: <無し か 足した commit・別の PR>／レビュー: #<頼みの番号> <判定>"
```

TPM 担当に【merge-request】が行き、状態が `回答待ち(TPM): merge` になる。

- **判定の後に PR の head が変わったら**（自分の commit・`git merge origin/main`・Dependabot の rebase や作り直し）、1 から頼み直す（見た commit が今の head と違うと、TPM 担当の `roster pr merge` が断る）。

## 5. 困ったら

- 迷ったら `roster ask tpm "<何に困っているか・試したこと・案と推し>" --waiting-for "<何を>"`。
- Product Manager の判断が要るときは、protocol.md の「Product Manager に確かめる」で `roster ask pm` を送る。
- 段の区切り（PR を出す前・merge を頼む前）に `roster inbox` で、まだ届いていないメッセージを見る。

## 6. 終わり

TPM 担当から merge 済みのメッセージ（【notify】）を受けたら:

1. 3 で作った worktree があれば消す。`roster chrome list` に自分が起こした Chrome が残っていれば、`roster chrome stop <pid>` で止める。
2. `roster report end --pr <PR の URL> --removed <消した worktree> … --left "<merge の commit／残した物>"` を打つ（PR 1 本の担当は、【dismiss】を待たずに【end】を送ってよい）。
3. **居場所は自分で閉じない。** TPM 担当が報告を受け取った後に閉じる。
