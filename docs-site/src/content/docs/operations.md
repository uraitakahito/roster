---
title: 運用
description: この repo を別の folder へ移す手順、Node の version の上げ方、依存が増えた PR を merge した後の手、アクターの台帳（castlist）が止まった時、ページの置き場（pagetray）の起こし方と保ち方、画面のサーバー（callboard）の起こし方、メッセージキュー（NATS）の起こし方と止まった時、手元の builder（buildkit）の守り、レビュー（Staff Engineer 担当の席）と監査（Auditor の席）の運び、課題の時間の分け（roster time）、CI と GitHub の見張り（roster watch）、担当が落ちた後の調べ方
---

## 課題の時間の分け（roster time）

課題に時間がかかった時に、何に使われたか（担当の手が動いていたのか・誰かの答えを待っていたのか・仕組み全体が止まっていたのか）を、記録から数で出す。席を増やして縮んだか（[分けた課題](#分けた課題tech-lead-担当と-repo-の席)）を、後から確かめるのにも使う。読むだけの命令で、どの担当も打てる（TPM 担当に聞けばよい）。

```sh
roster time AI-36            # 始めから終わりまで・どれかの席が作業中だった時間・長い空き・席ごとの時間
roster time AI-36 --gap 30   # 長い空きとみなす長さ（分。既定は 60）
```

- 集めるのは、その課題の担当・Staff Engineer 担当の席・Tech Lead 担当が起こした repo の席（とその Staff の席）の、状態 `wait` の移りの記録（状態の folder の `waits.jsonl`）。TPM 担当の状態は入れない。
- **席ごと**: 状態の字の種類（作業中・PM 待ち・TPM 待ち・Lead 待ち・レビュー待ち）ごとの時間。Staff Engineer 担当の席が次の頼みを待つ間は「次の頼み待ち」と分けて出す（課題の担当が判定を待つ「レビュー待ち」と混ぜない）。決まった字に当たらない状態（`メッセージキューが応えません`・`メッセージキューの写しが遅れています`）は、その字を名にして数える。状態は、次に替えるまで続いたとして数える。片付けの終わり（【end】）を送った後の状態は、次に作業中になるまで、どの種類にも数えない（席が閉じられるのを待つ間。担当を交代した Key では、次の担当の名乗りから、また数える）。席の最後の状態は、課題の最後の記録の時刻まで続いたとする（1 行目に、最後の記録が何かを出す）。席を足すと、始めから終わりまでより長くなる。
- **どれかの席が作業中**: 席の作業中の間を、重なりを 1 度だけ数えて足した物。
- **長い空き**: どの席の記録（状態の移り・送ったメッセージ・送る前の検査や guard が止めた回）も、決めた長さより長く動かなかった間。空きごとに、その間の席の状態を出す（片付けを終えた席は出さない）。**空きは「roster の命令を打たなかった間」**なので、担当が roster を打たずに長く手を動かした間（大きい実装・長い試験）も空きに入る。状態が「作業中」のまま空いた間（機械の止まり・利用の上限など）は、状態だけでは見えないので、「うち、長い空きに重なる分」で見る。Product Manager の答えを待った間も、空きとして出る（状態が PM 待ち・TPM 待ち）。
- 測れない物: 手伝い（subagent）の動き・CI の待ち・Claude Code の session の記録の時刻は読まない（roster の記録だけを読む）。席を閉じた時刻も、状態の記録に無い。状態は、担当が `roster wait` などで替えた字なので、答えが来た後に `roster wait work` を打ち忘れると、動いていた間も待ちに数えられる。session の記録も見た集計より、空きと待ちを多めに見積もる。
- 状態の移りを書くのは、`roster hello`（担当の名乗り）・`roster wait`・送る命令（【done】の後の待ちなど）・メッセージキューの止まり。担当の名乗りとメッセージキューの止まりは、この命令を入れた版から書くので、それより前の課題は、最初の `roster wait` から数え始まる（担当を交代した後の担当も、同じく最初の `roster wait work` から）。

## CI と GitHub の見張り（roster watch）

PR の CI・merge の後の main の workflow・GitHub の戻りを待つ仕事は、model を使わない命令 `roster watch` が受け持つ。担当は、この命令を**裏で起こして**（Claude Code の Bash の「裏で動かす」）手を止める。命令が終わると Claude Code が担当を起こし、終了コードを渡す。待つ間、担当はトークンを使わず、ほかの担当からのメッセージも届く。読むだけの命令で、どの担当も打てる。

```sh
roster watch pr <PR の URL>              # PR の今の head の commit の check が、みな終わるまで（既定 30 分）
roster watch main <PR の URL>            # merge した PR の、merge の commit で main に動いた workflow が、みな終わるまで（既定 30 分）
roster watch github [--repo <owner/repo>]  # GitHub が応えるようになるまで（既定 120 分）
roster watch pr <PR の URL> --timeout 0  # 今の様子を 1 回見て、待たずに終わる（--timeout は分）
```

| 終了コード | 意味 | 出す行 |
|---|---|---|
| 0 | 通った（`watch github` は、戻った） | `通った: check 5 つ（4 分 12 秒）` |
| 10 | 落ちた物がある | 落ちた check・workflow の名と URL。`watch pr` は、ほかがまだ動いていても、1 つ分かった時に終わる。`watch main` は、みな終わるまで待ってから終わる（`roster report merged` が、みな終わるまで送らないため） |
| 20 | まだ（長さを過ぎた。GitHub が応えないまま過ぎた時も） | まだの数と、もう 1 度見張る命令 |
| 30 | check・workflow の回が付いていない | 「通ったのではない」と出す。**0 にしない**（GitHub が遅い時に、CI を見ずに merge へ進まないため） |
| 1 | 見張れない（PR が無い・認証や権限が無い・merge していない PR の `watch main`・PR の URL でない字） | 訳 |

- **数では待たない。** `watch pr` は、付いている check がみな終わったかで判じる（docs と skill だけの PR は check が 3 つ、など、数は PR で違う）。check が 1 つも付いていない間は 5 分まで待ち、付かなければ 30 で終わる。
- **1 度見ただけでは「通った」にしない。** みな終わったのを、間を空けて 2 度続けて見てから 0 で終わる（遅れて付く check・遅れて作られる回を待つため。`--timeout 0` は 1 度だけ見る）。
- `watch main` は、PR の check の回（`pull_request`）を数えず、workflow ごとに、いちばん新しい回で判じる（落ちた `docs` を `gh workflow run docs.yml --ref main` で流し直した時は、新しい回を見る）。merge から 2 分の間は、回が無くても・在る回がみな終わっていても「まだ」と見る（回が、まだ作られきっていないことがある）。取り消された回（`cancelled`）は「落ちた」に数えない: `docs` は同じ concurrency の group で、merge が続くと、後の回が待っている回を取り消して公開する（見張りは、後の回が済ませたかまでは見ない。通った数には入れず、行に「・取り消し 1 つ」と出す）。
- `watch github` は、続けて 2 度応えたら「戻った」とする（戻りかけの揺れで起こさない）。`--repo` があればその repo を読めるかで、無ければ API が応えるかで見る。GitHub の障害は一部だけのことが多いので、落ちた手に近い repo を `--repo` で名指す（API が応えても、merge・push・Actions がまだ落ちていることはある。「戻った」の後に打ち直した命令がまた落ちたら、もう 1 度見張る）。上限（rate limit）に当たった時も、見張りは止まらずに聞き直す。
- 聞く間は 20 秒から始め、長く待つほど空ける（長くて 60 秒）。GitHub が応えない間も、`watch pr`・`watch main` は止まらずに聞き直す。途中の様子は出さない（担当が読む字を増やさないため）。
- 終わった見張り 1 回につき 1 行が、状態の folder の `watch.jsonl` に残る（始めた時刻とかかった秒を持つ。[決まりの記録](/protocol/)）。課題ごとに、CI を何分待ったかを後から数えられる。途中で止められた見張り（席が閉じた・担当が止めた）は残らない。

## 移す手順

1. TPM 担当のほかに動いている担当（Auditor も含む）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（[信頼のダイアログ](/getting-started/#信頼のダイアログ)。信頼は path に付くので、移すたびに要る）。
4. 新しい folder の `cli/` で `pnpm install --frozen-lockfile` を打つ（`cd <新しい folder>/cli && pnpm install --frozen-lockfile`）。`~/.local/bin/roster` の symlink を張っていれば張り直す（`ln -sf <新しい folder>/cli/bin/roster ~/.local/bin/roster`）。通知のバナーの hook（[設定](/configuration/#cmuxjson-に-hook-を足す)）を使っていれば、`roster banner setup` を打ち直して `~/.config/cmux/cmux.json` の命令を替え、`roster banner check` で確かめる（命令は repo の在り処を書いている。替えないと、古い在り処に入口が無いので hook は何もせず、バナーを選ばなくなる。`roster banner check` と TPM 担当の `roster hello` が在り処の違いを知らせる）。
5. 動いている TPM 担当は、`roster start` の 1 行で起こし直す（guard の hook と `roster` の在り処が古い folder を指しているため）。担当を起こす旗は `roster assign` が自分の場所から求めるので直さない。

使う側の project（TPM 担当を起こす folder）を移したときは、状態の folder（`~/.local/state/roster/<project の path から作った名>/`）も変わる。担当が 0 のときに移せば、古い folder は消してよい。

## 古い在り処と古い名から移る

道具の名を roster に替えたので（t-v28j）、在り処と環境変数も roster の名にした（t-6ydg）。

| 物 | 今の名 | 古い名 |
|---|---|---|
| 状態の folder | `~/.local/state/roster/` | `~/.local/state/tpm/` |
| 控えの folder | `~/.local/share/roster/pages/` | `~/.local/share/tpm/pages/` |
| cmux.json の hook の id | `roster-banner` | `tpm-banner` |
| 環境変数 | `ROSTER_KEY`・`ROSTER_STATE`・`ROSTER_MODEL` など | `TPM_KEY`・`TPM_STATE`・`TPM_MODEL` など |

- **folder**: 古い名の folder が本物の folder（symlink でない）で在れば、`roster` は空の状態を作らずに止まり、移す 1 行（`mv ~/.local/state/tpm ~/.local/state/roster && ln -s roster ~/.local/state/tpm`。控えも同じ形）を出す。移した後、その機械で移す前に起きた担当（古い path を持つ担当と、cmux が復元する居場所の命令）が居なくなったら、古い名の symlink は消してよい（`rm "${XDG_STATE_HOME:-$HOME/.local/state}/tpm" "${XDG_DATA_HOME:-$HOME/.local/share}/tpm"`）。両方が本物の folder なら（移す間に古い在り処へ書かれた）、割れていると言って止まる。
- **渡された状態の folder が無い時**: `$ROSTER_STATE`（か `--state`）の folder が無ければ、作らずに止まる（古い在り処の path のまま復元された居場所）。その居場所を閉じ、TPM 担当が起こし直す。
- **環境変数**: `roster` は新しい名だけを読む。古い名を読んでいた版から上げる前に、その機械で移す前に起きた居場所を閉じ、TPM 担当を新しい `roster start` の 1 行で起こし直す。担当の名を古い名（`TPM_KEY`・`TPM_STATE` など）だけで持つ居場所では、`roster` は止まり、閉じて起こし直すよう言う（その居場所を閉じた時の退場は、castlist に残らない）。利用者が書く古い名（`TPM_MODEL` など）と、古い `roster start` の 1 行の起こしの印（`TPM_LAUNCH` など）が残っていれば、TPM 担当の `roster hello` が知らせる。`guard` を通す開発の印も `ROSTER_RAW=1` だけ。
- **hook の id**: 古い id でも、`roster` は命令で hook を見つけるので動く。`roster banner check` が替える 1 行を出す。

## Node の version を上げる

1. repo の一番上の `.node-version` を新しい version（`26.14.0` のように patch まで）に書き替える。nodenv は `26` のような頭だけの version を受けない。GitHub Actions の 3 つの workflow も `node-version-file` でこのファイルを読むので、ほかは書き替えない。
2. 手元で `nodenv install` と、corepack の入れ直し（[Node と pnpm を入れる](/getting-started/#node-と-pnpm-を入れる)）。
3. 新しい version で試験と docs の検査を流してから PR にする（[開発](/development/)）。major を上げるときは `cli/package.json` と `docs-site/package.json` の `engines.node` と、`@types/node` も合わせる。

## 依存が増えた PR を merge した後

依存が増えた PR（`cli/package.json` と `cli/pnpm-lock.yaml` が変わる PR）を merge した後は、本体の checkout の `cli/` で `pnpm install --frozen-lockfile` を打つ（`cd <本体の checkout>/cli && pnpm install --frozen-lockfile`）。打つのは Product Manager か、頼まれた担当。

- 打たないと、新しい依存を読む命令が「module が無い」で落ちる。`cli/bin/roster` が入口で見るのは `cli/` の下の `node_modules` の folder が在るかだけで（無ければ、`pnpm install --frozen-lockfile` を打つよう言って 2 で終わり、guard も起きないので担当の Bash がみな止まる）、folder が在って依存が 1 つ足りない時は、入口を通り、その依存を読む所で初めて落ちる。
- 2026-11-27 に、NATS の client が入っておらず、メッセージキューに繋げなかった。NATS の client は、配りの口を作る時に初めて読むので、この時は、送る命令が「メッセージキューが応えません。送っていません」で止まり、括弧の中に module が見つからない訳が出る（NATS が動いていても出る）。

## 分けた課題（Tech Lead 担当と repo の席）

いくつもの repo に渡る大きい課題は、1 つの課題の中に席を増やして、repo ごとに並べて進められる。まとめるのは Tech Lead 担当で、repo を 1 つずつ受け持つのは Software Engineer 担当の席（repo の席）。決まりは `skill-sets/core/.claude/skills/_shared/protocol.md` の「分けた課題の中」、命令の作りは [決まりの実装](/protocol/#tech-lead-担当と-repo-の席)。

- **頼み方**: TPM 担当に「この課題は Tech Lead 担当にまとめさせて」と言う。言わなくても、TPM 担当が課題を読んで勧めることがある。席を増やすと使うトークンが増えるので、互いに依らない大きな仕事の組が 2 つ以上ある課題に向く（repo の間に順がある課題は、分けてもあまり縮まない）。
- **運び**: Tech Lead 担当が、まず計画（並べられる仕事の組・分けるかの見立て・席の数・repo の境の取り決め）を出す。**席の数は Product Manager が決める**（確認のページで聞かれる）。通した数が上限になり、超える席は命令が断る。
- **画面**: cmux に `Lead <課題の Key>: <題>`（赤の帯）と、`SWE <課題の Key> <名>: <題>`（緑の帯。repo の席）が並ぶ。repo の席の依頼書・成果・問い・レビューは、Tech Lead 担当との間をじかに届き、TPM 担当を通らない。やりとりは、「メッセージの記録」の画面（callboard の `http://127.0.0.1:8803/messages`）と、課題の folder のページ、課題管理の記録（repo の席の記録は `Software Engineer（<名>）` と出る）で見られる。
- **Product Manager への確認**は、Tech Lead 担当がまとめて送る（repo の席は送れない）。
- **レビュー**: repo の席の計画と PR は Tech Lead 担当が見る。Tech Lead 担当の計画と PR は Staff Engineer 担当が見る。
- **終わり**: Tech Lead 担当が、repo の席を片付けて閉じてから終える。課題管理の課題が済みになるのは、Tech Lead 担当が終えた時。
- model などを替えるなら、`.claude/roles/config.jsonc` の `tech-lead`（repo の席は `software-engineer`。席を起こす folder の設定が先に効く）に書く（[設定](/configuration/)）。

## レビュー（Staff Engineer 担当の席）

計画・提案・PR を、書いた者から離れた目で見るのは Staff Engineer 担当。席は、課題の担当がレビューを頼んだ時に、頼みの命令（`roster ask review`）がその課題の隣に起こす。頼みと判定は、TPM 担当を通らず、課題の担当と席の間をじかに届く（決まりは `skill-sets/core/.claude/skills/_shared/protocol.md` の「レビュー」）。Product Manager の手は、ふだんは無い。

- **必ずレビューを受けさせたい課題**は、TPM 担当に頼む時にそう言う（「この課題はレビューを受けさせて」）。TPM 担当が依頼書に「レビューを受ける」と書き、担当は計画と PR を必ず頼む。言わなければ、担当が要ると見た時だけ頼む。
- 頼まれると、cmux に `レビュー <課題の Key>: <見る物>`（`レビュー t-uepv: PR #180` など）の居場所ができる。題の下に見てほしい所が出て、左の端に紫の帯（帯の色は役割ごと。[居場所の色](/protocol/#居場所の色)）が付くので、その色でサイドバーのほかの担当の席と分かる。同じ席に次の頼みが届くと、題と説明はその頼みに替わる。Staff Engineer 担当は見る物と依頼書を読み、レビューのページ（callboard のページの一覧で、役割 `staff-engineer`・種類 `review`）を置いて返す。課題管理の課題には「レビュー」の記録が付く。
- レビューは助言で、受けるかは課題の担当が決める。担当が「直すべき」を受けない時だけ TPM 担当に上がり（`roster ask tpm --review <番号>`）、範囲・優先・設計の好みに関わる物は、TPM 担当が Product Manager に聞く。TPM 担当は、上がってこないレビューのメッセージを受け取らない。
- 席は、課題の担当の席と一緒に TPM 担当が閉じる。
- model などを替えるなら、`.claude/roles/config.jsonc` の `staff-engineer` に書く（[設定](/configuration/)）。席は頼みの命令が起こすので、課題ごとに旗で替える手は無い（TPM 担当が席を起こし直す時だけ、`roster assign --model`・`--effort` が効く）。既定は Opus 5.5・high。
- 起こした席が名乗らない（信頼のダイアログなど）時は、課題の担当が TPM 担当に知らせ、TPM 担当が Product Manager に頼む。
- どれだけ頼まれ、どう判じられたかは、`roster review list` で読める（TPM 担当に聞けばよい）。

```sh
roster review list            # 頼みごとの行と、判定ごとの数・TPM 担当に上げた数・レビューを頼んでいない課題の数
roster review list --key AI-12
```

出る行は「番号・課題の Key・判定（まだなら、席に渡していない・席が見ている（repo の席の頼みは Tech Lead 担当が見ている）・前の回の席に渡した（Tech Lead 担当なら、今の回には roster hello が並べる）・渡したが席がもう無い。TPM 担当に上げた頼みには、その印）・見る物・頼んだ時刻と返るまでの分・レビューのページ」。終わりの行の「レビューを頼んでいない課題」は、初めての頼みより後に結果の【done】を出した課題のうち、1 度も頼まなかった課題。頼む時を「いつも必ず」に上げるかを決める材料になる。

## 監査（Auditor の席）

監査は、Product Manager が呼んだ時にだけ始まる（自動では始まらない。目安は週 1）。Auditor は TPM 担当の回し方も見るので、席を起こすのも、呼ぶのも、報告を読んで答えるのも、Product Manager が `Audit` の席でじかにする。決まりは監査の規程（`skill-sets/core/.claude/skills/_shared/audit-charter.md`）。

### 席を起こす（初めと、roster を動かす機械を起こし直した後）

cmux の中の shell で、TPM 担当を起こした folder に移って打つ。

```sh
cd <TPM 担当を起こした folder>
<roster の置き場所>/cli/bin/roster audit start
```

- cmux に `Audit` の居場所ができ、Auditor が名乗って待つ。席は project に 1 つで、もうあれば「その席で `/clear` を打ってから、`/audit` を呼んでください」と断る。
- この命令は Product Manager が自分の手で打つ。TPM 担当とほかの担当が打つと guard が止める。
- model などを替えるなら `--model`・`--effort` を付けるか、`.claude/roles/config.jsonc` の `auditor` に書く（[設定](/configuration/)）。既定は Fable 5.2・high。

### 監査を呼ぶ

`Audit` の席で打つ。

| 打つ字 | すること |
|---|---|
| `/audit` | 定期の監査。台帳の出来事を見直し、調べ、前の勧告と「残り」を追いかけ、報告する |
| `/audit 7 9` | 臨時の監査。名指した件（台帳の番号）を調べ、報告する |

- **2 度目からは、先に `/clear` を打つ。** 前の監査の文脈が残ったままだと、Auditor が自分の前の勧告を自分で追いかけることになる。`/clear` していなければ、Auditor は監査を始めずに止まり、`/clear` を頼む（`roster audit begin` が、前の報告の後に `/clear` したかを記録で見る）。
- Auditor は件ごとの証拠集めを、会話の外の助手（`audit-evidence`。`context: fork`）に任せる。助手が返すのは事実と証拠の在り処と字だけで、Auditor は指摘に使う証拠を自分で開いて確かめてから、原因と勧告を書く。監査のページの指摘には「自分で確かめた証拠」が載る。
- 「[重い]」の件が台帳に入ると、TPM 担当が伝えてくる。調べさせるなら、`Audit` の席で `/audit <番号>` を呼ぶ。

### 報告を読んで、答える

1. 監査が済むと、`Audit` の席から通知のバナーが出る。席の画面に、要点と、決めてほしいこと（勧告ごとに、する・受け入れる・見送る）が出ている。詳しくは監査のページ（callboard のページの一覧で、役割 `auditor`・種類 `audit`）。
2. **その席に答えを書く**（「R1 はする、R2 は受け入れる、R3 は見送る」）。TPM 担当を通さない。
3. Auditor が、受け入れた件を台帳に書き、決定を TPM 担当に渡す。TPM 担当は、「する」の勧告を課題にして担当に振る。TPM 担当が起きていなければ、Auditor はそう言って待つ（TPM 担当を起こした後に、送り直させる）。

### 席を閉じる・起こし直す

- 席は Product Manager が閉じる（cmux で居場所を閉じる）。TPM 担当は閉じられない。閉じても、監査のページ・台帳・監査線の記録（状態の folder の `audits.jsonl`）は残る。
- 閉じた・消えた後は、上の `roster audit start` で起こし直す。

## アクターの台帳（castlist）

担当と Product Manager のアクターを残す、roster を動かす機械の中だけのサーバー（別の repo の [castlist](https://uraitakahito.github.io/castlist/)。`roster` が何を送るかは [担当のあいだの決まり](/protocol/#アクターの台帳castlist)、つなぐ設定は [設定](/configuration/#アクターの台帳castlist任意)）。**起こす・止める・data の volume を消すのは Product Manager だけ**で、命令は Product Manager が自分の terminal で直に打つ（手順は castlist の docs の「[動かす](https://uraitakahito.github.io/castlist/run.html)」）。

- castlist を設定した project で castlist が止まっていると、`roster start`・`roster assign`・`roster audit start`・`roster hello` は起こさず・名乗らずに止まり、打つ 1 行を出す。container（名は `castlist.box`。castlist 0.1.1 から）が在れば `container start castlist.box`、0.1.0 の docs の名 `castlist` の container だけが在ればその名で起こし直し、次に版を上げる時に名を替えるよう添える。どちらも無ければ `container run -d --name castlist.box -p 127.0.0.1:<port>:8080 -v castlist-data-v1:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:<版>`（`<port>` は設定の URL の port、`<版>` は `cli/src/castlist.ts` の `CASTLIST_VERSION`。今は `v1.0.0`）。初めて起こす時は、先に castlist の docs の「初めて起こす」（image の digest を見る・volume を作る）をする。
- 担当の居場所では、guard が Bash を止め、担当が TPM 担当に 1 行を渡す。TPM 担当は `roster wait pm "castlist を起こす" --hand` で Product Manager に頼む。
- roster を動かす機械を起こし直すと止まったままになる。`container system start` の後に `container start castlist.box` を打つ。
- 止めている間の session の始まりと終わりは、castlist に残らない（hook は送らずに終わる）。起きた後の初めの Bash で、guard が登録する。
- 監査では、Auditor が `roster castlist find`・`roster castlist show`・`roster castlist lineage`・`roster castlist events`・`roster castlist settings` でアクターを引く（読むだけ。[担当のあいだの決まり](/protocol/#監査の検索を読む)）。止まっている間は `castlist に聞けない` の 1 行で止まり、`roster incident timeline` はアクターの欄に「castlist に聞けない」と書いてページを置く。
- 答えを手で確かめ直す時だけ、castlist を動かす機械の terminal で、同じ GET を `curl` で打つ（例 `curl -s 'http://127.0.0.1:8802/api/actors?label=tpm.key%3At-23zs'`。引数の名は castlist の API の名（`activeFrom`・`maxResults` など。`roster castlist` の旗の名とは違う）で、時刻は UTC（`Z`）で書く。引数は castlist の docs の [API](https://uraitakahito.github.io/castlist/api.html) の「監査の検索」）。ふだんは `roster castlist …` を使う（名を id にし、行ごとにプロフィールの画面の URL を添える）。書く要求（POST・PUT）は手で送らない。
- **トークンの数と費え**（castlist 2.1.0 から）: roster が、席が閉じる時・席を閉じる命令・TPM 担当の 1 時間に 1 度の片付けで、Claude Code の session の記録から数だけを読んで castlist に送る（[担当のあいだの決まり](/protocol/#トークンの数と費え)）。人の手は要らない。見るのは callboard の費えの画面（`http://127.0.0.1:8803/usage/`）。
  - 抜けていないかを見る: `roster castlist usage-check`（窓の既定は 31 日前〜1 時間前。読むだけ）。「合わない席」が出たら、`roster castlist usage`（まだ送っていない席をみな送る。上限なし）の後に、もう 1 度。それでも合わなければ `roster report incident` で台帳に挙げる。
  - castlist が止まっていた間・古い版の間の分は、起きた後の片付けで送られる。ただし session の記録は Claude Code が 30 日で消すので、その前に送られていない分は戻らない。
  - castlist が断った行は、状態の folder の `usage-refused.jsonl` に残る（`usage-check` が数を出す）。

## ページの置き場（pagetray）

依頼書と成果のページを置く、roster を動かす機械の中だけの置き場。担当が `roster page put` で置いたページを DB に持ち、API で渡すサーバー（別の repo の [pagetray](https://github.com/uraitakahito/pagetray)。この repo とのつなぎは [開発](/development/#pagetrayページの置き場のサーバーとのつなぎ)）を、Apple Container（`container` CLI）で動かす。`127.0.0.1` だけで待ち受け、LAN にもインターネットにも開かない。起こす・止める・直すのは DevOps Engineer 担当で、命令は `roster infra run pagetray -- <命令>` で打つ（この repo と pagetray の repo の `.claude/roles/config.jsonc` が、環境 `pagetray` を「TPM に相談」の手続きで宣言している）。

| 物 | 値 |
|---|---|
| image | `ghcr.io/uraitakahito/pagetray:<版>`。版と digest は、この repo の `.pagetray-version`（`v<版>@<digest>`。この repo の cli と合わせてある版） |
| container | `pagetray.box`（pagetray 1.2.0 から。前の名は `pagetray`。同じ network の callboard が、この名で届く。`127.0.0.1:8801` と `127.0.0.1:8800` → 中の 8080。メモリは Apple Container の下限の 200 MiB、CPU は 1） |
| URL | `http://127.0.0.1:8801`（ページは `/<状態の folder の名>/<Key>/<種類>-<番号>.html`、ページが参照する file は `/<状態の folder の名>/<Key>/files/<語>-<番号>.<拡張子>`）。pagetray は 2.0.0 から画面を持たない。ページの一覧とメッセージの記録の画面は callboard にある（[画面のサーバー](#画面のサーバーcallboard)）。前の画面の URL（`http://127.0.0.1:8801/`・`/<project>/`・`/<project>/<Key>/`・`/messages`）は 404 を返す。`http://127.0.0.1:8800/` は、前の置き場（Nginx。今は無い）の port。前に置いたページの URL と、ページの中の link を同じ path で開けるように、同じ container が待ち受ける |
| CLI | `pagetray`（置き場を端末から操作する命令。release に macOS arm64 用の binary が付く。入れ方と命令は pagetray の docs の「[CLI](https://uraitakahito.github.io/pagetray/cli.html)」）。担当は `roster page` を使い、`pagetray` は人の手元と、`roster` を通さない場面で使う。担当の `pagetray page delete` は guard が止める |
| 控えの folder | `~/.local/share/roster/pages/`（`roster` が、置いた・読んだページと file を roster を動かす機械に写す所。container には mount しない） |
| DB | 名前つきの volume `pagetray-data-v1`（中の `/data/pages.db`。1.0.0 から）。roster を動かす機械の folder は mount しない |

**手順は、pagetray の docs の「[動かす](https://uraitakahito.github.io/pagetray/run.html)」にある**（起こす・確かめる・DB の写しを取る・写しから戻す・止める・版を上げる）。そこの命令のうち、container と volume に触る物は、頭に `roster infra run pagetray --` を付けて打つ。下は、この repo の側の決まりだけを書く。

### 起こす

```sh
container image pull ghcr.io/uraitakahito/pagetray:<版>
container volume create pagetray-data-v1     # 初めての時だけ
roster infra run pagetray -- container run -d --name pagetray.box \
  -p 127.0.0.1:8801:8080 \
  -p 127.0.0.1:8800:8080 \
  -v pagetray-data-v1:/data \
  -m 200M -c 1 \
  -e PAGETRAY_CASTLIST_URL=http://castlist.box:8080 \
  ghcr.io/uraitakahito/pagetray:<版>
```

- `<版>` は `.pagetray-version` の `@` の前（`v2.0.0` など）。pull した image の digest が `@` の後ろと同じかを見る（見方は pagetray の docs の「[起こす](https://uraitakahito.github.io/pagetray/run.html#起こす)」）。
- `-p` には必ず `127.0.0.1:` を書く。`-p 8801:8080` と書くと LAN に開く。
- container の名は `pagetray.box`。Apple Container の DNS は、domain `box` の付いた名だけを答えるので、画面のサーバー（callboard）は、この名で置き場に届く（前の名 `pagetray` では引けない）。担当が使う URL と、置いたページの URL（`http://127.0.0.1:8801`）は変わらない。前の名で動いている container は、版を上げる時に、前の名で止めて消してから（`container stop pagetray`・`container delete pagetray`）、この名で起こす（volume はそのまま付く）。この repo の `.claude/roles/config.jsonc` は、どちらの名の命令も「TPM に相談」の手続きに入れてある。
- `PAGETRAY_CASTLIST_URL` は、置き場が送り手を castlist（[アクターの台帳](#アクターの台帳castlist)）に聞く先。`roster page put`・`roster file put` は、castlist の設定がある project では送り手（session の付随する id）を付けて置き、置き場が受けたその時に castlist に聞いて記録に残す（[担当のあいだの決まり](/protocol/#ページの置き場)）。container の中の `127.0.0.1` は container 自身なので、castlist の container `castlist.box` に名でつなぐ（Apple Container の DNS が domain `box` の名を答える）。
- `PAGETRAY_CASTLIST_URL` を書いた置き場は、castlist が止まっている・名で届かない間、送り手を付けた置く要求を `503` で断る（何も置かない。`roster page put` は「castlist に送り手を聞けませんでした」と出す）。castlist を起こすのは Product Manager（[アクターの台帳](#アクターの台帳castlist)）。castlist が起きているのに続く時は、置き場から `castlist.box` に届いていない（同じ network に居ない・名が違う）。
- 8801 が使われていたら別の port にし、担当が使う URL を環境変数 `ROSTER_PAGES_URL`（[設定](/configuration/)）で合わせる。
- 起こしたら、pagetray の docs の「[確かめる](https://uraitakahito.github.io/pagetray/run.html#確かめる)」をする。試しのページを置いたら、TPM 担当が `roster page delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。
- 「確かめる」の後に、callboard のページの一覧を見る。ページの一覧が 200 で開き、pagetray の前の一覧が 404 を返すこと。出力を結果のページに載せる。

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8803/pages/   # 200
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8801/         # 404
  ```

- callboard の画面を読むだけで見る手順は、callboard の docs の「[確かめる](https://uraitakahito.github.io/callboard/run.html)」にある。browser で一覧を見ることを、Product Manager に頼まない。どちらかが違ったら、違った所を【ask-tpm】で知らせる。

### 止める・roster を動かす機械を起こし直した後

- 止めている間、担当はページを置けず（番号をサーバーが決めるため）、callboard のページの一覧とメッセージの記録は「pagetray に聞けません」の 503 の画面になる（担当は、控えにあるページなら読める）。先に【ask-tpm】を送り、答えを待つ。止めるのは `roster infra run pagetray -- container stop pagetray.box`。DB は volume に残る。
- roster を動かす機械を起こし直すと止まったままになる。`container system start` の後に `roster infra run pagetray -- container start pagetray.box` を打ち、「確かめる」をする。
- volume（`pagetray-data-v1`）は消さない。消す命令（`container volume delete`・`rm`）と、付けて起こす命令（`-v pagetray-data…`。写しから戻す時の書き込みも）を「TPM に相談」の手続きに入れてある（この repo の `.claude/roles/config.jsonc`）。
- **DB の写し**（`curl -fsS -o ~/pagetray-$(date +%Y%m%d-%H%M).db http://127.0.0.1:8801/api/backup`。CLI が入っていれば `pagetray backup -o ~/pagetray-$(date +%Y%m%d-%H%M).db` でも同じ）は、版を上げる前と volume に触る前に取る。本文は控えの folder にも残るが、置いた担当の役割と workspace の ID は DB にだけある。

### 控えから取り込む

DB を失い、写しも無くて、空の volume で起こした時は、控えの folder のページを置き場に入れる。

```sh
roster page import
```

- 控えにあって置き場に無いページと file（`<Key>/files/`）を、同じ番号・file の時刻で入れる。何度打っても同じ結果になる。
- 置いた担当はわからないので、役割は依頼書と課題の写しだけ `roster`、ほかは `unknown`、居場所は空で入る（DB の写しから戻せば、これらも戻る）。
- 「消したページ」と出た物は、置き場で消した番号（`roster page delete`）。控えにだけ残っていた物で、入れない。
- 「ぶつかった」と出たページは、同じ番号に別の中身が置き場にある。入れていないので、要る物なら `roster page put` で置き直す。

### 版を上げる

pagetray の新しい版が出て、この repo の `.pagetray-version` が上がった時（上げ方は [開発](/development/#pagetrayページの置き場のサーバーとのつなぎ)の「pagetray を上げる時」）。

1. pagetray の `CHANGELOG.md` で、API の版が変わるか・移行の SQL が足されるかを見る。
2. 【ask-tpm】で止める時を決める。
3. pagetray の docs の「[版を上げる](https://uraitakahito.github.io/pagetray/run.html#版を上げる)」のとおりに、DB の写しを取り、container を作り直して、確かめる（volume はそのまま付く）。確かめた後に、上の「起こす」のとおり callboard のページの一覧を見る。
4. `roster page`・`roster file` などが「置き場が、この roster の呼ぶ操作を持たない」と言って止まる時は、置き場が `.pagetray-version` より古い版で動いている。`.pagetray-version` の版で起こし直す。

0.8.x から 1.0.0 へは、API と移行の SQL がみな替わり volume も替わったので、この手順でなく、pagetray の docs の「[release を出す](https://uraitakahito.github.io/pagetray/release.html)」の「切り替え」でした（済み。切り替えの前の volume は 2026-11-26 に消したので、1.0.0 より前には戻せない）。

### 秘密を上げてしまった時

担当が token などの写った file を上げてしまったら、TPM 担当が `roster file delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。置き場の DB からは消えるが、**前に取った DB の写し（`~/pagetray-*.db`）には残る**。消した後に新しく写しを取り、古い写しを消す。その token は、漏れた物として取り消す（作り直す）。

### ほかの project で使う

置き場は roster を動かす機械に 1 つで、どの project の担当も同じ置き場を使う（callboard のページの一覧では project で絞れる）。ほかの project で TPM 担当を起こすときも、その project の `.claude/roles/config.jsonc` に、この repo と同じ `infra.pagetray` の宣言を写す（写さないと、その project の担当は止める命令を断りなく打てる。[設定](/configuration/#環境の手続き)）。

## 画面のサーバー（callboard）

castlist（アクターの台帳）と pagetray（ページの置き場）の画面をまとめるサーバー（別の repo の [callboard](https://github.com/uraitakahito/callboard)。AI-32）。castlist と pagetray を API で呼び、画面の HTML を組んで返す。data は持たない（DB も volume も無い）。Apple Container（`container` CLI）で動かし、`127.0.0.1` だけで待ち受ける。起こす・止める・版を上げるのは DevOps Engineer 担当で、命令は `roster infra run callboard -- <命令>` で打つ（callboard の repo の `.claude/roles/config.jsonc` が、環境 `callboard` を「TPM に相談」の手続きで宣言している。roster は、project の folder の直下の folder の宣言も合わせて読む）。

| 物 | 値 |
|---|---|
| image | `ghcr.io/uraitakahito/callboard:<版>`。版と digest は、この repo の `.callboard-version`（`v<版>@<digest>`） |
| container | `callboard`（`127.0.0.1:8803` → 中の 8080。メモリは Apple Container の下限の 200 MiB、CPU は 1） |
| URL | `http://127.0.0.1:8803/`（入口。castlist と pagetray が生きているかと、画面への link）。castlist の 4 つの画面は、みな callboard にある（0.2.0 から）: アクターの一覧（`/actors/`）・プロフィール（`/actors/<id>`）・タイムライン（`/graph/timeline`）・相関図（`/graph/network`）。pagetray の 2 つの画面も callboard にある: メッセージの記録（`/messages`。0.3.0 から。新しい記録は、押さずに入る）・ページの一覧（`/pages/`。0.4.0 から。Key の画面で file を上げられる）。費え（`/usage/`。0.5.0 から。席ごとのトークンの数と額の表と図。castlist 2.1.0 が要る。アクターの一覧に額の列、プロフィールに節「費え」も）。移した 6 つの画面は、みな callboard にあり、pagetray は 2.0.0 から画面を持たない（前の画面の URL `http://127.0.0.1:8801/`・`/messages` などは 404）。ページの本文と file の中身は、pagetray（8801）が持ち、browser が pagetray から直に読む（置いたページの URL は、前のまま `http://127.0.0.1:8801/…`） |
| 聞く先 | castlist は `http://castlist.box:8080`（`CALLBOARD_CASTLIST_URL`）、pagetray は `http://pagetray.box:8080`（`CALLBOARD_PAGETRAY_URL`）。どちらも container の名でつなぐ（Apple Container の DNS は、domain `box` の付いた名だけを答える。container の中の `127.0.0.1` は container 自身なので、host の port には届かない）。pagetray の container が前の名 `pagetray` のままだと、名では届かず、入口は pagetray を「届きません」と出す（castlist の画面には響かない）。その時は、上の「ページの置き場」の「起こす」のとおり、`pagetray.box` の名で作り直す |
| data | 無い。止めても、消しても、起こし直せば元のまま |

**手順は、callboard の docs の「[動かす](https://uraitakahito.github.io/callboard/run.html)」にある**（設定・起こす・止める・版を上げる・確かめる）。そこの命令のうち、container に触る物は、頭に `roster infra run callboard --` を付けて打つ。下は、この repo の側の決まりだけを書く。

- **起こす版**: `.callboard-version` の版。`<版>` は `@` の前。取った image の digest が `@` の後ろと同じかを見る（見方は、上の「ページの置き場」の「起こす」と同じ）。
- **起こす順**: castlist と pagetray より先に起こしてもよい（聞けない間は、入口に「届きません」と訳を出す）。
- **確かめる**: callboard の docs の「確かめる」を、1 から 6 まで流す（`/healthz` の版・`127.0.0.1:8803` だけに開いているか・入口・記録の行）。入口の画面で、castlist と pagetray が「つながっています」と出ること（pagetray が「届きません」の時は、上の「聞く先」）。メッセージの記録（`http://127.0.0.1:8803/messages`）とページの一覧（`http://127.0.0.1:8803/pages/`）と費え（`http://127.0.0.1:8803/usage/`）が 200 で開くこと。castlist と pagetray の版が、callboard の `CHANGELOG.md` の「呼ぶ先の要る版」より古くないこと（0.5.0 は castlist 1.1.0 から（費えの数は 2.1.0 から）・pagetray 1.3.0 から。pagetray が古いと、ページの一覧やメッセージの記録の画面が「pagetray に聞けません（404 が返りました）」になる。castlist が古いと、タイムラインが「castlist に聞けません（404 が返りました）」になり、一覧とプロフィールの「時刻ずれ」の印と、状態の横の出来事の名が、誤りを出さずに消える。castlist が 2.1.0 より古いと、費えの画面が「castlist に聞けません（404 が返りました）」になり、一覧の額の列とプロフィールの節「費え」が「—」と訳になる）。「届きません」の時は、`container logs callboard` の `呼ぶ先に聞けない` の行（どの呼ぶ先か・聞く先・訳）を読む。
- **止まっている時**: 画面が開けないだけで、担当の仕事（ページを置く・メッセージを送る・アクターの登録）は止まらない。アクターの画面（一覧・プロフィール・タイムライン・相関図）は callboard だけにある（castlist は 2.0.0 から画面を持たない）ので、止まっている間は見られない。ページの一覧とメッセージの記録も callboard だけにある（pagetray は 2.0.0 から画面を持たない）ので、止まっている間は見られない。`roster castlist …`・`roster page list` の命令（読むだけ）と、置いたページの URL（8801）は、そのまま使える。
- **版を上げる**: callboard の新しい版が出て、この repo の `.callboard-version` が上がった時（上げ方は [開発](/development/#callboard画面のサーバーとのつなぎ)の「callboard を上げる時」）。callboard の `CHANGELOG.md` の「呼ぶ先の要る版」を見て、castlist・pagetray がその版より古ければ、先にそちらを上げる（castlist を上げるのは Product Manager）。その後、container を消して、新しい版で起こし直す（data が無いので、写しは要らない）。
- **戻す**: この repo の `.callboard-version` を前の版に戻す PR を先に入れてから、前の版の image で起こし直す（版の file が新しいままだと、次に起こし直す時に、また新しい版で起こしてしまう）。castlist・pagetray も戻す時は、それぞれの版の file の PR を戻して前の版で起こし直してから、callboard を戻す（新しい操作を呼ぶ callboard を、古い castlist・pagetray に向けている間は、その画面が 503 になる。短い間で、data は失わない）。

## メッセージキュー（NATS）

担当どうしのメッセージを預かり、受け手ごとに配る段取り（取り置き・渡せたの確かめ・渡し直し・上限・期限）を受け持つ、既存のオープンソース [NATS](https://nats.io/) の server（JetStream を入れて使う）。roster は、これを「配りの口」（`cli/src/mailroom/`。[開発](/development/#nats-jetstreamメッセージキューとのつなぎ)）の向こうに置く。**担当どうしのメッセージは、いつもここを通る**（cmux は運ばない。roster を使う project では、NATS が動いていること。下の「[届くことを確かめる・戻す](#届くことを確かめる戻す)」）。Apple Container（`container` CLI）で動かし、`127.0.0.1` だけで待ち受ける。起こす・止める・上げるのは DevOps Engineer 担当で、命令は `roster infra run nats -- <命令>` で打つ（この repo の `.claude/roles/config.jsonc` の「TPM に相談」）。

| 物 | 値 |
|---|---|
| image | `nats:<版>`（Docker Hub の公式の image）。版と digest は、この repo の `.nats-version`（`v<版>@<digest>`。つなぎの試験が流している版） |
| container | `roster-nats`（`127.0.0.1:4222` → 中の 4222） |
| 設定 | この repo の `nats/nats-server.conf`（container の `/etc/nats` に読むだけで付ける）。預かった物を書くたびに disk に書く（`sync_interval: always`） |
| data | 名前つきの volume `roster-nats-data`（中の `/data`）。届いていないメッセージ・取り口の位置・取り置き・記録が入る |

### 起こす

```sh
container image pull nats:<版>
container volume create roster-nats-data     # 初めての時だけ
roster infra run nats -- container run -d --name roster-nats \
  -p 127.0.0.1:4222:4222 \
  -v roster-nats-data:/data \
  -v <この repo の checkout>/nats:/etc/nats:ro \
  nats:<版> -c /etc/nats/nats-server.conf
```

- `<版>` は `.nats-version` の `@` の前から頭の `v` を取った物（`2.15.3` など）。pull した image の digest が `@` の後ろと同じかを見る。
- `-p` には必ず `127.0.0.1:` を書く。NATS は置いた者を確かめないので、LAN に開かない。
- 起きたかは `container logs roster-nats` の `Server is ready` と `Version:` の行で見る。
- 箱（stream）と取り口（consumer）は、roster が要る時に作る。手で作らない。

### 止める・roster を動かす機械を起こし直した後

- 止めている間、**どの席も、どこへも送れない**（送る命令はみな「メッセージキューが応えません。送っていません」で止まり、居場所の状態（サイドバー）に「メッセージキューが応えません」と出る。直してと頼む `roster ask devops` も同じ）。課題に記録を書く命令は、記録を書く前に止まる。確認・提案・計画・結果・レビューのページを置く `roster page put` も、置く前の検査で止まる。
- cmux に落として送る道は無い。`roster report incident` だけは、止まらずに台帳に書き、「メッセージキューが応えないので、TPM 担当には送っていない（台帳には書いた…）」と出して終わる。止まっている事は、台帳と、席の状態で気づく（止まった回は `gate.jsonl` に `queue` と残る）。
- だから、止める前に、止めると【ask-tpm】で知らせ、答えを待つ。止めるのは `roster infra run nats -- container stop roster-nats`。
- roster を動かす機械を起こし直すと止まったままになる。`container system start` の後に `roster infra run nats -- container start roster-nats` を打つ。預かった物・取り置き・取り口の位置は volume から戻る（取り置き中だった物は、取った時から 30 秒の所で渡し直される）。
- volume（`roster-nats-data`）は消さない。

### 届くことを確かめる・戻す

roster を使う project では、NATS が動いていること（project ごとに入れる・外す設定は無い。[設定](/configuration/#メッセージを配る道)・届き方は[担当のあいだの決まり](/protocol/#メッセージを-nats-で配る道)）。`.claude/roles/config.jsonc` に前の版の `"messages": "cmux"` が残っていると、設定の誤りで止まるので、その行を消す。

**確かめる**

1. NATS が起きていることを見る（上の「起こす」）。
2. 前の版で起こした席（メッセージを渡す hook を持たない席）は、TPM 担当を `roster start` の 1 行で、担当を `roster assign` で起こし直すと、hook を持つ。起こし直すまでも、その席宛ての物は NATS に置かれ、その席の `roster inbox` と送る前の検査が、命令の結果に本文を出す（手を止めている間には届かない）。
3. 確かめ: 起こした席の状態の folder に `mail/claims/<受け手の名>.jsonc` が出来ていること。その席に送ったメッセージの `log.jsonl` の行に `"carrier":"nats"` が付き、渡った後に `delivered.jsonl` に行が足されること。メッセージの記録の画面（callboard の `http://127.0.0.1:8803/messages`）では、状態が「まだ届いていない」から「届いた」に、押さずに替わる。

**見張る物**

- 名乗りが出来ない席（Claude Code の process の番号が分からない起こし方）には、hook が渡さない。その席宛ての物は NATS に残り、その席の `roster inbox` と送る前の検査が、命令の結果に本文を出す（残りは 72 時間で消える）。`mail/claims/` に file が無ければ、これ。
- `delivered.jsonl` に `"when":"output"` の行が増えるのは、渡す hook が働いていない印（名乗っていない席に、`roster inbox`・送る前の検査が本文を命令の結果に出した回か、名乗っている席で、止めた後に渡す hook が働かず、検査が本文を出して通した回）。
- TPM 担当の命令の結果に「渡せない」「期限切れ」の行が出たら、その 1 通は届いていない。要る中身なら送り直す。
- NATS を止めている間は、どの席もどこへも送れない（上の「止める・roster を動かす機械を起こし直した後」）。席の状態に「メッセージキューが応えません」と出ていないか、台帳に「TPM 担当には送っていない」件が無いかを見る。
- `roster mail left`（TPM 担当だけ。読むだけ）が、NATS に残っている物（まだ渡っていない物）を、受け手ごとに出す。

**戻す**

cmux で運ぶ道は、設定では戻せない（コードから外してある）。戻すのは、cmux の道を外した PR（roster の「cmux でメッセージを運ぶ道を外しきる」の PR）を戻す（revert する）こと。

1. 戻す前に、TPM 担当が `roster mail left` を打ち、NATS に残っている物を、受け手ごとに見る。
2. 残っていれば、受け手に渡るのを待つ（手を止めた時・人の入力の時に hook が渡す）か、TPM 担当が、その中身を、戻した後に送り直す。
3. その PR を戻し、TPM 担当と担当の席を起こし直す（席の hook は、起こした時の版の物）。

### NATS の CLI（待つ命令を軽くする。任意）

roster を動かす機械に NATS の CLI（`nats`。[nats-io/natscli](https://github.com/nats-io/natscli) の公式の release）があると、手を止めている席の待つ命令が、Node.js の process を居続けさせずに、CLI で待つ（手を止めた席 1 つにつき、memory が 127MB ほど → 32MB ほど。届き方は[担当のあいだの決まり](/protocol/#メッセージを-nats-で配る道)）。無くても動く（今までどおり Node.js で待つ）。

- 入れるのは DevOps Engineer 担当（担当は【ask-devops】で頼む）。公式の release の binary を、checksum（`SHA256SUMS`）を照らして `~/.local/bin/nats` に置く（`PATH` に無い時も、roster は `~/.local/bin/nats`・`/opt/homebrew/bin/nats`・`/usr/local/bin/nats` を探す。ほかの所なら `$ROSTER_NATS_CLI` に path を書く）。2026-11-27 に v0.5.2 を入れた。
- 入れた後・外した後に、席を起こし直す要は無い（次に手を止めた時の待つ命令から替わる）。
- 使わせない時は、席を起こす環境に `ROSTER_NATS_CLI=none` を書く。
- 確かめ: 手を止めている席があれば、`pgrep -fl 'nats sub roster\.'` に `nats sub roster.<project>.msg.<受け手の名> --count 1` が、席の数だけ出る（NATS の URL は環境変数で渡すので、ここには出ない）。
- NATS の CLI の context（`nats context`。`~/.config/nats`）は作らない・選ばない。選んであると、CLI がその context の認証や TLS で繋ごうとして、roster の client と違う繋ぎ方になる（繋げない時は、3 度で Node.js の待ち方に替わる）。

### 版を上げる

NATS の release を見て、`.nats-version` を新しい版と digest にする PR を出す（つなぎの試験 `nats-e2e` が、その image に向けて通る）。merge の後に、container を新しい版で作り直す（volume はそのまま付ける）。

## 1.0.0 への切り替え（済み）

castlist と pagetray は、1.0.0 で API も DB も替えた（AI-36 の切り替え。castlist は `castlist-data-v1`、pagetray は `pagetray-data-v1` の volume で動く）。切り替えの前の volume（`castlist-data`・`pagetray-data`）は 2026-11-26 に消したので、1.0.0 より前の版には戻せない。この repo の roster も、1.0.0 からの API だけを話す。

## 手元の builder（buildkit）

担当が手元で image を build する時に、Apple Container の `container build` が使う container（名は `buildkit`）。roster を動かす機械に 1 つで、並べて動いている担当がみな同じ物を使う。止める・消す・作り直すと、ほかの担当の build が途中で落ちる。この repo の `.claude/roles/config.jsonc` が、環境 `builder` を「TPM に相談」の手続きで宣言している（変えてよいのは DevOps Engineer 担当だけ）。

| 命令 | guard |
|---|---|
| `container build …`・`container builder status`・`container logs buildkit` | 止めない（どの担当も打つ） |
| `container builder start`・`stop`・`delete`・`rm`、container の名を名指す `container stop`・`kill`・`delete`・`rm buildkit`、`--name buildkit`・`--name=buildkit` | DevOps Engineer 担当だけ。`roster infra run builder -- <命令>` で打つ |

- `container build` は、builder が止まっていれば自分で起こす（Apple Container 1.7.1）。だから担当は `container builder start` を打たない。roster を動かす機械を起こし直した後も、初めの build が起こす。
- **担当は `container build` に `-c`（`--cpus`）・`-m`（`--memory`）・`--ssh`・`--dns`・`--dns-domain`・`--dns-search`・`--dns-option` を付けない。**build も `container builder start` も、動いている builder の CPU・メモリ・DNS・ssh の転送が頼んだ物と違うと、builder を止めて消し、作り直す（ほかの担当の build が落ちる）。guard の `match` は環境の名の付いた命令に当てるので、名の無いこの旗の付いた build は止められない。builder の大きさや DNS を変える要があれば、`roster ask devops` で頼む。今の builder は既定の CPU 2・メモリ 2048 MB。
- 起こし直す（中から名前が引けないなど）のは DevOps Engineer 担当で、先に【ask-tpm】で何が止まるか（その間の build）を送る。`roster infra run builder -- container builder stop` の後に `roster infra run builder -- container builder start`。旗を付けずに起こすと既定の大きさになる。

## 担当が落ちた後の調べ方

担当の Claude Code の session・cmux・container が思わず止まった時に、何が・いつ・どの process の合図で止まったかを、後から引く手順。2026-11-23 の朝（05:33:17 JST）に、担当の session が打った `pkill -f "castlist-server" -n` が、command line に `-n` を含む process すべてに SIGTERM を送り、担当の session 3 つ・cmux-cua の helper・container がいっせいに止まった件（台帳 #89）は、この 3 つの手で元まで追えた。見張りは置いていないので、記録は macOS と Claude Code が元から残す物だけ。

- 打つのは読むだけの命令に限る。process を止める・合図を送る命令は、確かめのためにも打たない。
- 今は、`pkill`・`killall` と pid を名指さない `kill` を、roster が起こした session では guard が止める（[担当のあいだの決まり](/protocol/#guard)）。止まるのは「うっかり」までで、script に包んだ物や Product Manager の手元の session は止めない。
- 分かった事実は `roster report incident` で台帳に書く（[担当のあいだの決まり](/protocol/#台帳)）。原因を調べ、扱いを決めるのは Auditor。
- 下の命令の日時は、今朝の件の値。落ちた時刻に替えて打つ。

### 先に、刈られる前に残す

macOS の記録（unified log）は、OS が古い物から自分で刈る（目安は約 3 週間）。Claude Code の transcript も、既定では 30 日で消える。落ちたと気づいたら、日を置かずに 1 と 3 の行を file に書き出しておく（`… > ~/crash-20261123.log`。roster を動かす機械の中に置き、外に写さない）。

記録がいつの分から残っているかは、`/usr/bin/log stats | sed -n '/== archive/,/^end:/p'` の `start:` で見る（2 分ほどかかる）。

### 1. macOS の記録から、終わり方と合図の送り手を引く

```sh
/usr/bin/log show --start "2026-11-23 05:33:00" --end "2026-11-23 05:35:00" --style compact \
  --predicate 'process == "launchd" AND eventMessage CONTAINS "exited due to"' \
  | grep -v mdworker
```

今朝の件では、こう出た（抜き書き）。

```text
05:33:17.661 … [gui/501/application.com.cmuxterm.cua.… [96743]:] exited due to SIGTERM | sent by pkill[89723], ran for …
05:33:17.788 … [gui/501/com.apple.container.container-network-vmnet.default [31628]:] exited due to SIGTERM | sent by pkill[89723], ran for …
05:34:13.587 … [gui/501/com.apple.container.container-runtime-linux.pagetray [37192]:] exited due to SIGTERM | sent by launchd[1], ran for …
```

- zsh では `log` が shell の組み込みの命令で、`log show …` は `too many arguments` で止まる。`/usr/bin/log` と path で書く。
- 時刻は roster を動かす機械の時間帯で書き、そのまま出る。
- `exited due to` の後ろが終わり方（SIGTERM・SIGKILL など）、`sent by` の後ろが合図を送った process と pid。`sent by launchd[1]` は launchd が止めた（上の行の daemon が止まった後の片付けなど）。今朝は、`pkill[89723]` が先に container の network の daemon を止め、約 1 分後に launchd が container の runtime を止めた。
- 出るのは launchd の job だけ（cmux の helper `application.com.cmuxterm.…`、container の daemon `com.apple.container.…`、container ごとの runtime `com.apple.container.container-runtime-linux.<container の名>`）。Claude Code の session は launchd の job でないので出ない。session は 2 で見る。
- `mdworker`（Spotlight）が `sent by mds` で止まる行は、いつも多く出るので grep で外す。job の名（`[gui/501/…]` の所）は `--predicate` の `eventMessage` に入らないので、名で絞るのも grep でする。
- 送り手の pid（`pkill[89723]`）からは、打った session は分からない。2 で、その時刻の少し前に打たれた命令を探す。

### 2. transcript から、最後の時刻と打った命令を引く

transcript は `<Claude Code の設定の folder>/projects/<起こした folder の path の / を - にした名>/<session の id>.jsonl`（設定の folder は `CLAUDE_CONFIG_DIR`、無ければ `~/.claude`）。中の時刻は UTC（`Z`）。

落ちた頃に書くのが止まった transcript ごとに、最後の時刻・file・最後に打った命令を出す。落ちた session はその後に書き足されないので、file の更新の時刻が落ちた頃に入る（`-newermt` の日時は roster を動かす機械の時間帯）。

```sh
cd "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
find . -name '*.jsonl' -newermt '2026-11-23 05:30' ! -newermt '2026-11-23 05:40' | while read -r f; do
  printf '%s\t%s\t%s\n' \
    "$(jq -r 'select(.timestamp) | .timestamp' "$f" | tail -1)" "$f" \
    "$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | (.input.command // .name) | .[0:120]' "$f" | tail -1)"
done | sort
```

合図を送った命令は、1 の `sent by` の時刻の前の数分に、どこかの session が打った `kill`・`pkill`・`killall` を探す（時刻は UTC で書く。05:33 JST は前の日の 20:33Z）。

```sh
find . -name '*.jsonl' -newermt '2026-11-23 05:20' | while read -r f; do
  jq -r --arg f "$f" 'select(.type=="assistant" and .timestamp >= "2026-11-22T20:28" and .timestamp <= "2026-11-22T20:34")
    | .timestamp as $t | .message.content[]? | select(.type=="tool_use") | (.input.command? // "")
    | select(test("\\b(pkill|killall|kill)\\b")) | "\($t)\t\($f)\t\(.[0:160])"' "$f"
done
```

- 今朝の件では、1 つ目で 20:28Z〜20:33Z に書くのが止まった transcript が 4 本並び、2 つ目で 20:33:15.193Z（05:33:15 JST）に castlist の folder の session が `pkill -f "castlist-server" -n` を打っていたのが出た。`sent by pkill` の 2 秒前。
- folder の名は `-` で始まる（`-Users-me-work`）。`./` を付けずに `jq … -Users-me-work/….jsonl` と書くと、jq が option と読んで止まる。`find .` の出力は `./` で始まるので、そのまま渡せる。
- file の名が session の id。どの担当の session かは、Auditor が `roster castlist` で引く（[アクターの台帳](#アクターの台帳castlist)）。

### 3. container の起動の時刻を見る

```sh
container list --all
/usr/bin/log show --start "2026-11-23 05:33:00" --end "2026-11-23 06:10:00" --style compact \
  --predicate 'process == "launchd" AND (eventMessage CONTAINS "exited due to" OR eventMessage CONTAINS "Successfully spawned")' \
  | grep 'container-runtime-linux\.\(pagetray\|castlist\)'
```

- `container list --all` の `STARTED` は、最後に起きた時刻（UTC）だけ。その後にもう 1 度起こし直すと書き替わる（今朝の castlist.box は 05:36:49 に起き直したが、06:05 に版を上げて起こし直したので、`STARTED` は 06:05 の物になっていた）。
- 止まった時刻と、それまでの起き直しの時刻は、2 つ目の命令の行（launchd の `exited due to` と `Successfully spawned`）に残る。今朝は、pagetray・castlist.box とも 05:34:13 に止まり、05:36:49（castlist.box）と 05:39:05（pagetray）に起き直していた。
- container の exit code と、起こし直す前の `container logs` は残らない（container の CLI の上流の issue #2402）。container の中の process がきれいに止まったのか、VM ごと切られたのかは、ここからは分からない。
- それは、道具が自分で残す記録で分かる（pagetray は 0.7.0 から、castlist は 0.3.0 から）。`curl -s http://127.0.0.1:8801/api/logs`（castlist は `curl -s http://127.0.0.1:8802/api/logs`）が、終わり方の印と、起こし直す前の時刻つきの行を返す。起きるたびに出る `previous: …` の行が、前回の終わり方（きれいに止まった・panic・誤りで終わった・停止の印なし）。「停止の印なし」は、合図も来ずに切られたことまでで、VM ごと切られた・SIGKILL・メモリ不足のどれかは見分けない（誰が止めたかも、道具からは見えない。上の機械の側の記録を合わせて読む）。読み方は pagetray の docs の「[落ちた後に調べる](https://uraitakahito.github.io/pagetray/run.html)」と、castlist の docs の「[落ちた後に調べる](https://uraitakahito.github.io/castlist/run.html)」。
