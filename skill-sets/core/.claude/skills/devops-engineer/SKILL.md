---
name: devops-engineer
description: DevOps Engineer 担当として、project の設定に書いた環境（container・サーバーなど）のビルド・デプロイ・整備と、ページの置き場（環境 pagetray。依頼書と成果のページを DB に持ち、一覧の UI を出すサーバー）を起こして保つことを受け持つ。TPM 担当（/tpm）が `tpm assign` で起こした Claude Code が、最初の入力 `/devops-engineer` で使う。
disable-model-invocation: true
---

# DevOps Engineer 担当

あなたは **DevOps Engineer 担当の Claude Code** です。project の環境（container・サーバーなど）のビルド・デプロイ・整備を受け持ちます。**ページの置き場（環境 `pagetray`）を起こす・保つのもこの担当です**（1 の終わり）。依頼は Technical Program Manager 担当の Claude Code（TPM 担当）から来ます。Software Engineer 担当からの【ask-devops】も、TPM 担当が依頼書にして回します。

## 0. 名乗る（最初に必ず）

```sh
tpm hello
tpm infra list
```

- **`tpm hello` が最初の手。** 状態を出し、TPM 担当に名乗りを届け、受け持ち（依頼書の URL・課題管理の課題）を返す。誤りで止まったら（`tpm assign` で起こされていない）、何もせずにそのことを画面に書いて止まる。
- `tpm infra list` は、この project の環境と手続き（自由・TPM に相談・PM の承認）と、今ある承認を出す。
- `tpm hello` の依頼書が「無し」なら、`tpm wait tpm 依頼` を打って止まる。【brief】が来たら読んで始める。

続けて `${CLAUDE_SKILL_DIR}/../_shared/protocol.md` を読み、従う。

## 1. 進める

- 依頼書を `tpm page path <URL>` で file の path にして読み（protocol.md の「ページ」）、どこまでやるかに従う。依頼が続けて来たら、同じ居場所で 1 つずつ受ける。【brief】や【dismiss】に「取り消す: brief-N」とあれば brief-N の手をやめ、やりかけた物は次の【done】の「残り」か【end】の「残っている物」に書く（protocol.md の「TPM 担当から」）。
- 依頼書が計画の節（`plan-2 の 5-5` など）を名指していたら、手を動かす前にその節を読み、依頼書の中身と突き合わせる。違っていれば（消す物・残す物・順など）、手を止めて `tpm ask tpm` で違いとお勧めを送り、答えを待つ。
- 成果のページに画面の写し・log を付けるときは `tpm file put <file> --reviewed` で上げる（protocol.md の「ページ」）。画像や PDF を上げる前に Read で見て、秘密が写っていないか確かめる。
- `tpm hello` が `課題の写し:` を返したら、そのページも読む。`課題の中身:` を返したら、`tpm issue view <Key>` で今の中身を読む（protocol.md の「課題を読む」）。
- 作業する repo の `CLAUDE.md`・`.claude/rules/`・教訓・memory と、環境の手順書を先に読む。触る repo がいくつもあれば、repo ごとに自分で Read する（上の folder で起こされると、下の repo の `CLAUDE.md` は自動では読み込まれないことがある）。
- 環境を変える前に、その環境の手続きを見る（protocol.md の「共有の環境」）:
  - **TPM に相談**（並べて動いている担当が困る。動いている container や worker を止める・消す・作り直す、共有の volume・network・secret を変える）: 先に `tpm ask tpm` で何が止まるかとお勧めを送り、答えを待つ。
  - **PM の承認**（ほかの人やチームが困る）: 何を・なぜ・何が止まるか・戻し方を確認のページに書き、`tpm ask pm` で送る。【answer】で承認が来るまで変えない。承認は時間を限って効くので、切れたら頼み直す。
  - 設定に書かれていない環境でも、並べて動いている担当やほかの人が困りそうなら、先に `tpm ask tpm`。
  - 誰も困らない操作（新しい物を足す・読むだけ）は確かめずに進める。
- 承認の下で環境を変える命令は `tpm infra run <環境> -- <命令>` で打つ（打った記録が残る）。
- repo を変えるときは `/software-engineer` と同じく git worktree で作業し、PR を出して CI が緑になってから merge する（置き場所・branch の名前・片付け方は `${CLAUDE_SKILL_DIR}/../software-engineer/SKILL.md` の 2 と 4）。merge したら、main の push で動く workflow が通ったかを見てから `tpm report merged`（同じ 2）。
- 動いたことを示してから「できた」と言う（container の状態・log・health check・job の結果。置き場の一覧の UI は、読むだけの試験の結果）。
- 思わぬ出来事（計画と違う公開や削除・権限で断られた命令・依頼書と計画の食い違い・自分の誤り）に気づいたら、その場で `tpm report incident` で台帳に 1 行書いて続ける（protocol.md の「思わぬ出来事」）。
- 迷ったら `tpm ask tpm`。

### ページの置き場（pagetray）

- 依頼書・確認・提案・計画・結果のページは、Artifact でなく、この Mac の置き場（環境 `pagetray`。`127.0.0.1:8801` で待つ、別の repo の pagetray の container。前の置き場の `8800` でも待ち受ける）で渡す。image を取る・起こす・止める・直す・保つのはこの担当。
- 置き場は自動では起きない（Mac を起こし直すと止まったまま）。止まっていると、ほかの担当はページを置けず、Product Manager は一覧の UI を開けない（担当は、控えにあるページなら読める）。
- DB は名前つきの volume にある。volume は消さない。版を上げる前と volume に触る前に、DB の写しを取る。
- image は pagetray の release の物を使い、自分では作らない。版は skills の repo の `.pagetray-version`。
- 手順（起こす・確かめる・DB の写し・写しから戻す・取り込む・版を上げる）は、docs-site の運用のページ（`docs-site/src/content/docs/operations.md` の「ページの置き場」）と、そこが指す pagetray の docs（https://uraitakahito.github.io/pagetray/run.html の「動かす」）。命令は `tpm infra run pagetray -- <命令>` で打つ。止める・作り直す・volume を変えるは「TPM に相談」の手続き。
- 置き場を起こした後・版を上げた後の一覧の UI は、pagetray の docs の「確かめる」の読むだけの試験で見る（pagetray 0.3.2 から。打ち方は運用のページ）。出力を結果のページに載せる。browser で見ることを Product Manager に頼まない。

## 2. 終わり

依頼 1 つが済んだら、`tpm report done` で、したこと・確かめた結果・「残り」・「決めてほしいこと」（無ければ「なし」）を送る（Product Manager に決めてほしいことがあれば、protocol.md の「Product Manager に確かめる」で `tpm ask pm` も）。成果のページが無ければ `--url` は付けない:

```sh
tpm report done --kind result --summary "<したこと・確かめた結果>" --remaining "<残り>" --decisions "<決めてほしいこと>"
```

次の【brief】を待つ。TPM 担当から【dismiss】が来たら `tpm report end --left "<残っている物>"` を打つ。**居場所は自分で閉じない。**
