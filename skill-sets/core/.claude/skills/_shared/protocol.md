# 担当のあいだの決まり（どの担当も読む）

TPM 担当（`/tpm`）・Software Engineer 担当（`/software-engineer`）・Tech Lead 担当（`/tech-lead`）・DevOps Engineer 担当（`/devops-engineer`）・Staff Engineer 担当（`/staff-engineer`）・Sustaining Engineer 担当（`/sustaining-engineer`）・Auditor（`/audit`）が共通に従う決まり。依頼主は Product Manager（利用者）。返答と報告は日本語で書く。

担当どうしのやりとりは、すべて `roster` の命令でする。`roster` が、メッセージを送る・課題に記録を書く・状態を出す、を 1 度にする（相手が見たかは、送る時には見ない。後で roster が、hook が本文を渡した時刻と、roster が見せた時刻から引く）。連携の道具（cmux など）の命令と、課題管理の道具（Jira・GitHub の Issue）で記録を書く・状態を進める命令は直に打たない（直に打つと記録と状態が抜けるので、guard が止める）。課題管理の課題を読む命令は止めないが、読むときも `roster issue view` を使う（下の「課題を読む」）。どの道具を使うかは、TPM 担当を起こした folder と、その直下の folder の `.claude/roles/config.jsonc` を合わせた設定で決まる（下の repo をいくつも触る課題のため。課題の記録の先は、課題の Key の形で決まる）。

## 連絡の仕方

- メッセージは、下の「見出し」の表の命令で送る。命令は「送った」を返す（届いたかは見ない）。相手が手を動かしている間は届かず、空いたら届くので、送り直さない。
- メッセージは、メッセージキュー（NATS）が預かり、席の hook が本文を渡す（連携の道具の cmux は運ばない）。渡るのは 3 つの時: 手を止めている間（届くと起こされる）・人が入力した時・送る前の検査が命令を止めた直後。段の区切り（PR を出す前・merge を頼む前）と、戻せない手（tag を打つ・release を出す・消す）の前には `roster inbox` で、まだ渡っていない自分宛てのメッセージを見る（出るだけで、届いたにはならない。hook が後で渡す）。
- メッセージを送る命令は、送る前に、自分宛てでまだ渡っていないメッセージが無いかを見る（TPM 担当は、送る相手の担当から来た物だけ）。あれば 1 度止まる（送っていない。課題の記録も書いていない）。本文は、止まった直後に hook が渡す。渡された物を読んで、同じ命令を打ち直す。届いたメッセージで事情が変わっていたら、中身を変えて打つ。「直前に、hook がメッセージを渡しました」と止まった時も、渡された物を読んでから打ち直す。渡す hook を持たない session（名乗れなかった席・前の版で起こした席）では、検査と `roster inbox` が、本文を命令の結果に出す（打ち直しは通る）。`roster page put` も、確認・提案・計画・結果・レビューのページ（`--kind confirm|proposal|plan|result|review`）は、置く前に同じように見て 1 度止まる（置いていない）。事情が変わっていたら、ページを書き直して置く。
- **打ち直しは、止まったのを見てから別の回に打つ。**`;` や `||` で 1 行に続けて書かない（止まらなかった時にも 2 度目が動く）。同じメッセージを 30 秒の内に 2 度送ろうとすると、命令は 2 度目を送らずに止まる。
- 届いたメッセージには id が付いている。そのメッセージへの返事は `--reply-to <id>` を付けて送る。
- 宛先は書かない。担当のメッセージは TPM 担当へ行き、TPM 担当は課題の Key で担当を名指す。**レビューの頼みと判定だけは、TPM 担当を通らない**: 命令が、課題の担当と、その課題の Staff Engineer 担当の席の間を、じかに届ける（下の「レビュー」）。**分けた課題の中**（Tech Lead 担当と、その repo の席の間）も、TPM 担当を通らない（下の「分けた課題の中」）。
- **Product Manager に直接聞かない。** Product Manager とのやりとりは、すべて TPM 担当を通す。例外は Auditor だけ: Product Manager が起こした `Audit` の席で、Product Manager とじかに話す（下の「監査」）。
- **メッセージキューが応えない時**: 送る命令は、どれも「メッセージキューが応えません。送っていません」で止まり、席の状態にもそう出る（`roster ask devops` も同じ。ほかの道具で送らない）。`roster report incident` だけは、台帳に書いて「TPM 担当には送っていない」と出して終わる（打ち直さない。台帳に 2 件になる）。メッセージキュー（NATS）が動いているかを確かめてもらい（担当は送れないので、止まった事を返答に書く。TPM 担当は Product Manager に伝える）、動いてから同じ命令を打ち直す。
- 命令の使い方は `roster <命令> --help`。命令が誤りで止まったら、出た文に従って直す（道具の命令に替えて先へ進まない）。

## 見出し

### TPM 担当へ

| 見出し | いつ | 命令 |
|---|---|---|
| 【ask-tpm】 | TPM 担当に決めてほしいことがある（レビューの判定を受けずに上げる時は、`--review <頼みの番号>` を付ける。下の「レビュー」） | `roster ask tpm "<困っていること・試したこと・案とお勧め>" --waiting-for "<何を>" [--review <番号>]` |
| 【ask-pm】 | Product Manager に決めてほしいこと・頼むことを確認のページに書いて置いた（下の「Product Manager に確かめる」） | `roster ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>" [--supersede <置き換える古い確認の URL>…]` |
| 【ask-devops】 | 共有の環境で DevOps Engineer 担当の手が要る（下の「共有の環境」） | `roster ask devops --what "<何を>" --why "<なぜ>" [--urgent]` |
| 【doc-fix】 | 文書やコメントの食い違いを直した PR を merge した | `roster report doc-fix --pr <URL> --note "<一言>" [--unchecked "<訳>"]` |
| 【incident】 | 思わぬ出来事（信頼性・安全性・効率性が落ちた）に気づいた（下の「思わぬ出来事」） | `roster report incident "<起きた事実>" --type <reliability\|safety\|efficiency> [--tag <tag>] [--severe]` |
| 【merged】 | 自分の PR を 1 本 merge した | `roster report merged --pr <URL> --note "<一言>" [--unchecked "<訳>"]` |
| 【done】 | 依頼書の成果（提案・計画・結果・監査のページ）を置いた（1 通で依頼書いくつかを済ませたら、`--briefs` でみな名指す） | `roster report done --url <URL> --kind <proposal\|plan\|result\|audit> --summary "<要点>" --remaining "<残り>" --decisions "<決めてほしいこと>" [--briefs <brief-2,brief-3>]` |
| 【end】 | 【dismiss】を受けて片付けた（Sustaining Engineer 担当は PR を merge した後） | `roster report end --url <URL> --pr <URL> … --removed <worktree> … --left "<残っている物>"` |

- 【done】の「残り」は、依頼の外で直すとよい物・やらなかった物・merge していない PR。「決めてほしいこと」は、【ask-pm】で送った項目の題。どちらも無ければ「なし」と書く（書かないと送れない）。TPM 担当はこの 2 つで【dismiss】を送るかを決める。
- 【end】の「残っている物」は、計画から外れた物・残した物で直した方がよい物。無ければ「なし」。
- 【merged】【doc-fix】と【end】の `--pr` は、命令が送る前に PR が merge 済みか（`gh pr view` の state が `MERGED`）を見る。merge していなければ送らずに止まるので、merge を確かめてから打ち直す。`gh` で読めない PR だけ、自分で確かめた方法を `--unchecked "<訳>"` に書いて送る（訳はメッセージに載る）。【merged】【doc-fix】は、merge の後の main の workflow も命令が見る（下の「待つ・見張る」）。

Dependabot の PR だけで使う見出し（【merge-request】【not-yet】【recreated】）は `/sustaining-engineer` と `/dependabot-triage` に書いてある。【returned】は前の版の見出しで、今は誰も送らない（古い記録に残っているだけ）。

Staff Engineer 担当は、【done】【end】【merged】【doc-fix】【ask-pm】【ask-review】を送らない（命令が断る）。成果は、下の【review】で課題の担当へじかに返す。

### 担当から担当へ（レビュー。TPM 担当を通らない）

| 見出し | 誰から誰へ | いつ | 命令 |
|---|---|---|---|
| 【ask-review】 | 課題の担当 → その課題の Staff Engineer 担当の席 | 計画・提案のページか PR を見てほしい（下の「レビュー」）。席が無ければ、命令が席を起こして依頼書で渡す（その時、メッセージは無い） | `roster ask review --url <見る物の URL> [--focus "<見てほしい所>"]` |
| 【review】 | Staff Engineer 担当 → 頼んだ課題の担当 | レビューのページと判定を返す | `roster report review --url <レビューのページの URL> --verdict <判定> --summary "<一言>"` |

宛先は、どちらも命令が名簿から引く（書かない）。送り手の名は、命令が名簿の題から付ける。

### 分けた課題の中（Tech Lead 担当と repo の席。TPM 担当を通らない）

いくつもの repo に渡る課題を Tech Lead 担当がまとめる時、Tech Lead 担当は repo ごとの席（repo の席。Software Engineer 担当）を起こす。repo の席から見ると、Tech Lead 担当が「自分に仕事を振る者」で、上の表の TPM 担当に当たる。

| 見出し | 誰から誰へ | いつ | 命令 |
|---|---|---|---|
| 【ask-lead】 | repo の席 → Tech Lead 担当 | Tech Lead 担当に聞きたいこと・決めてほしいことがある（Product Manager に決めてほしいことも、これで送る。repo の席は【ask-pm】を送れない） | `roster ask lead "<問い・試したこと・案>" --waiting-for "<何を>"` |
| 【brief】【notify】【dismiss】 | Tech Lead 担当 → repo の席 | 次の依頼書・知らせと問いへの答え・片付けの指示（中身は、下の「TPM 担当から」と同じ） | `roster seat brief <名> --brief <URL> [--supersede\|--after]`・`roster seat notify <名> "<本文>"`・`roster seat dismiss <名> [--supersede]` |

- repo の席の【done】【merged】【doc-fix】【end】は、命令が Tech Lead 担当へ届ける（命令は同じ。宛先を書かない）。【incident】【ask-devops】【ask-tpm】は、repo の席からも TPM 担当へ届く（Tech Lead 担当の席が応えない時の相談は【ask-tpm】）。
- repo の席の【ask-review】は、Staff Engineer 担当の席でなく、Tech Lead 担当へ届く（命令は同じ `roster ask review`）。Tech Lead 担当は、Staff Engineer 担当と同じ `roster report review` で返す（返していない頼みがいくつもある時は、`--review <番号>` で名指す）。Tech Lead 担当自身の計画と PR は、Staff Engineer 担当が見る。
- repo の席を起こすのは `roster seat add <名> --brief <URL>`、片付けの終わった席を閉じるのは `roster seat close <名>`（どちらも Tech Lead 担当）。

Auditor（監査の担当。Product Manager が起こす `Audit` の席）だけが使う見出しは 2 つ。【audit】は、Product Manager へじかに出した監査の報告の写し（`roster report audit`）。【decided】は、Product Manager の決定（`roster report decided`）。Auditor は、【done】【end】【merged】【doc-fix】【ask-pm】【ask-review】を送らない（下の「監査」）。

### TPM 担当から

| 見出し | 中身 | 命令（TPM 担当が打つ） |
|---|---|---|
| 【brief】 | 新しい依頼書の URL（Staff Engineer 担当への依頼書は、レビューの頼みから命令が作る）。下の「ページ」のとおり読み、それに従う。「取り消す: brief-N」とあれば brief-N の作業をやめてこちらに従い、「brief-N を済ませてから、これをする」とあれば brief-N の【done】の後に始める | `roster assign <Key> --role <役割> --brief <URL> [--supersede\|--after]` |
| 【answer】 | Product Manager の答え。待ちの表示を作業中に戻して続ける | `roster answer <Key> "<答え>" [--url <確認の URL>…\|--all]` |
| 【notify】 | 知っておくこと・中身のある返事（決定・直し・次の手）。「受け取った」だけの返事は、TPM 担当は送らない。返事は要らない | `roster notify <Key> "<本文>"` |
| 【dismiss】 | この課題に続きは無い（Product Manager が決めたか、TPM 担当が聞かなくてよいと決めた）。worktree を片付けて【end】を返す。担当の交代のためなら、そう書いてある。「取り消す: brief-N」とあれば brief-N の作業もやめる | `roster dismiss <Key> [--handover] [--supersede]` |

この表の命令と `roster close` は、担当の session から打つと断られる（送り手の名は命令が付けるので、担当が打つと TPM 担当の名で届いてしまう）。TPM 担当に頼むことは `roster ask tpm` で送る。

## 状態

- 出すのは **`model` と `wait` の 2 つだけ**。`model` は名乗ったとき（`roster hello`）に出る。
- `wait`: 「今、誰が何を待っているか」を 1 つだけ。状況が変わるたびに上書きする。
  - 自分が動いている: `roster wait work "<段>"`（`作業中: <段>`）
  - Product Manager の答えを待つ: `roster wait pm "<何を>"`（`回答待ち(PM): <何を>`）。TPM 担当が Product Manager に手の操作を頼んで待つ回は `--hand` を付ける（下の「思わぬ出来事」）
  - TPM 担当の答えを待つ: `roster wait tpm "<何を>"`（`回答待ち(TPM): <何を>`）
  - レビューの相手を待つ: `回答待ち(レビュー): <何を>`（`roster ask review`・`roster report review` が出す。手では打たない）
  - Tech Lead 担当の答えを待つ（repo の席）: `roster wait lead "<何を>"`（`回答待ち(Lead): <何を>`）
  - 待つ時間に限りがあれば添える: `roster wait tpm "merge（14:30 まで）"`
- `roster wait` は打った時刻も覚える。Product Manager への通知のバナーは、TPM 担当が**その回に** `roster wait pm` を打って手を止めた時に出る（設定は docs の「設定」の「通知のバナー」）。
- やりとりの命令は、メッセージを送った後の待ちも出す（`roster ask …` は回答待ち、`roster ask review` は `回答待ち(レビュー): <見る物>`、`roster report done` は `回答待ち(TPM): 次の依頼`、`roster report end` は `回答待ち(TPM): workspace を閉じる`。repo の席では、`回答待ち(Lead): 次の依頼`・`回答待ち(Lead): 席を閉じる`）。答えが来たら `roster wait work "<段>"` に戻す。
- **`/model`・`/effort` は打たない**（新しい session の既定まで書き換わる）。model と effort は起動の旗で決まる。

## 記録

課題管理の課題（`roster hello` が返す「課題管理の課題」）があれば、やりとりの命令のうち下の表の物が、課題にコメントを 1 件書く。課題が無い・課題管理を使わない project では何も書かない。担当が自分で課題にコメントを書いたり、状態を進めたりはしない。

| 命令 | 書く記録（1 行目は `【<種類>】<担当>: <一言>`） |
|---|---|
| `roster report done --kind <種類>` | `提案`・`計画`・`結果`・`監査`（`--kind` の `proposal`・`plan`・`result`・`audit`）。成果の URL と、`--point` の要点（3 つまで） |
| `roster report doc-fix` | `文書の修正`。PR の URL |
| `roster report review` | `レビュー`。レビューのページの URL と、判定 |
| `roster ask pm` | `確認`。確認のページの URL と、項目の題 |
| `roster answer`（TPM 担当） | `決定`。【answer】を返す前に書かれる |
| `roster report end` | `結果`。続けて課題を済みにする（担当の交代の【dismiss】のときは済みにしない） |

- 中身はページに書き、記録には写さない。
- GitHub の Issue を使う project では、PR の題か本文に課題の Key を書くとき `Refs #12` と書く。`Closes #12` と書くと merge で勝手に閉じ、【dismiss】で閉じる決まりとずれる。

## 思わぬ出来事

担当の仕組み（`roster`・skill・この決まり・ページの置き場）で思わぬことが起きたら、気づいた担当が、その場で台帳に 1 行書く。書くのは事実だけ（何が起きたか）。原因はその場で調べず、仕事を続ける。後で Auditor が見直し、調べる（下の「監査」）。

| 種類（`--type`） | 例 |
|---|---|
| `reliability`（信頼性） | うその知らせを送った・行き違い（答えが届く前に先へ進んだ）・誰のしたことか分からない変化・計画や依頼書の誤り |
| `safety`（安全性） | 公開や削除が計画と違った・守り（guard・手続き）をすり抜けた・戻せない手を確かめずに打った |
| `efficiency`（効率性） | 権限が足りず人の手が要った・同じことを 2 度した・長く待たされた |

- 担当は `roster report incident "<起きた事実>" --type <種類>`（TPM 担当に【incident】が行く）。**自分の誤りも書く。**
- session の権限で断られた命令は、`--tag 権限` を付けて書く。別の書き方で通そうとしない。
- すぐ止めないと害が広がる物は `--severe` を付ける。TPM 担当が、すぐ Product Manager に伝える（監査を呼ぶかは Product Manager が決める）。
- 【done】の「残り」と【end】の「残っている物」は、「なし」でなければ命令が台帳に入れる（書き直さなくてよい）。【end】の「残っている物」は、同じ Key の未決の【done】の「残り」があれば、その件に寄せる（新しい件にしない）。TPM 担当が Product Manager に手の操作を頼んだ回（`roster wait pm "<何を>" --hand`）も入る。前の wait がその頼みのまま打ち直した `--hand` は、前の件に寄せる。この 2 つ（種類の無い件）は、TPM 担当が扱う（振る・調べない・済み）。
- `roster incident timeline <件の番号|課題の Key>` が、その前後の記録（メッセージと届いた時刻・課題管理への書き込み・guard と入口の検査が止めた回・`wait` の移り）を時刻の順に 1 枚のページにして置く。届く前に相手が次を送った所には「行き違い」の印が付く。原因を調べる Auditor が読む。
- 原因の調べと、種類のある件（出来事）の扱い（調べない・済み）を決めるのは、Auditor（下の「監査」）。TPM 担当は出来事を「調べない」「済み」にできない（命令が断る）。振り先を結ぶ・tag を足すことはできる。
- TPM 担当は `roster incident add <Key> "<起きた事実>" --type <種類>` で書く。見直す・扱いを決める命令（`roster incident review` など）は、TPM 担当と Auditor のほかの担当からは打てない。
- **台帳・送ったメッセージの記録（state の `*.jsonl`）は、メッセージや命令の字を持つ。roster を動かす機械の外（課題管理のコメント・PR の本文・公開の site）に写さない。**【incident】は課題管理に記録を書かない。

## 監査

担当の仕組みが、信頼でき、安全で、むだなく回っているかは、Auditor が調べる。Auditor は TPM 担当の回し方も見るので、監査は TPM 担当の手を通らない。何のために・どこまで・誰に、は監査の規程（この folder の `audit-charter.md`。Product Manager が承認した物）にあり、どの担当もそれに従う。

- **始めるのは、いつも Product Manager。** Product Manager が `roster audit start` で `Audit` の席を起こし、その席で `/audit`（定期の監査。目安は週 1）か `/audit <件の番号…>`（臨時の監査）を呼ぶ。自動では始まらない。
- **報告は Product Manager へじかに。** Auditor は監査のページを置き、`Audit` の席で Product Manager に報告する。TPM 担当には写し（【audit】）が行く。Product Manager はその席で答え、Auditor が決定を TPM 担当に渡す（【decided】）。
- **TPM 担当**は、【audit】を伝え直さない。【decided】の「する」の勧告を、いつもの課題として担当に振り、`roster incident assign <番号>… --to <振り先の Key>` で件に結ぶ。Auditor からの【ask-tpm】（事実の確かめ）には、知っていることを答える。
- **TPM 担当とほかの担当は、監査を止めない・範囲を狭めない。** `Audit` の席を起こさない・閉じない（`roster audit start` を打つのは Product Manager。`roster assign`・`roster dismiss`・`roster close` は、この席を断る）。Auditor の置いたページを消さない（消す訳があれば、Product Manager の言葉を `roster page delete … --pm "<言葉>"` に添える。記録に残る）。
- **Auditor は直さない・決めない。** repo・設定・環境を変えず、PR を出さず、課題を振らず、課題管理に書かない（書き込みと `git`・`gh` の変える命令は guard が止める）。どの改善をするか・受け入れるかは Product Manager が決める。
- Auditor の席に、依頼書・【dismiss】・【end】は無い。席は Product Manager が閉じる。

## レビュー

計画・提案・PR を、書いた者から離れた目で見るのは、Staff Engineer 担当。課題ごとに、課題の担当の隣に席が立つ（名簿の Key は `<課題の Key>.staff`、居場所の題は `レビュー <課題の Key>: <見る物>`（`PR #180`・`計画 plan-2` など）。題の下の説明は見てほしい所で、席の左の端に紫の帯が付く。題と説明は、命令が頼みのたびに替える）。**頼みと判定は、TPM 担当を通らず、課題の担当と席の間をじかに届く。**

1. **頼む**（課題の担当）: `roster ask review --url <見る物の URL> [--focus "<見てほしい所>"]`。見る物は、置き場のページ（計画・提案）か PR の URL。命令が、頼みから席への依頼書を作って置き、**席が無ければ起こし**（名乗るまで待つ。90 秒まで）、**居れば【ask-review】を席へじかに送る**（見直しは、前の指摘を知る同じ席がする。前の頼みがまだ返っていなければ、その後ろに積まれる）。状態が `回答待ち(レビュー): <見る物>` になる。待つ間、レビューに依らない作業は続けてよい。
2. **見て返す**（Staff Engineer 担当）: レビューのページを置き（`roster page put <file> --kind review`。課題の Key の folder に入る）、`roster report review` で返す。【review】が、頼んだ課題の担当へじかに届き、課題があれば「レビュー」の記録が書かれる。
3. **扱う**（課題の担当）: レビューのページを読み、指摘を自分で確かめてから扱う。

| 判定 | 意味 | 課題の担当のすること |
|---|---|---|
| よい（`approve`） | このまま進めてよい | 進む |
| 気になる所あり（`concerns`） | 直した方がよい所がある | 指摘ごとに、直す・直さない（訳）を決めて進む |
| 直すべき（`reject`） | このまま進めると害がある | 直して、見直しを頼む（もう 1 度 `roster ask review`）。受けないなら、自分で決めずに TPM 担当に上げる（下） |
| 見られなかった（`not-assessed`） | 材料が足りない・読めない | 足りない物を足して、頼み直す |

- **レビューは助言で、課題の担当を縛らない。** 受けるか・直すかは課題の担当が決める。
- **意見がぶつかった時だけ、TPM 担当に上げる。** 課題の担当が「直すべき」を受けない時は、自分で決めず、`roster ask tpm "<受けない訳・案とお勧め>" --waiting-for "<何を>" --review <頼みの番号>` で上げる（TPM 担当は判定を受け取っていないので、命令がレビューのページの URL を本文に足し、上げたことを頼みの記録に残す。`--review` が受けるのは、自分の課題の、判定が「直すべき」の頼みだけ）。決まるまで、その PR は merge しない。TPM 担当は、依頼書と Product Manager の言葉で決まる物は自分で決め、範囲・優先・設計の好みは Product Manager に聞く。レビューの担当に伝えることがあれば、TPM 担当が `roster notify <課題の Key>.staff` で伝える（repo の席の頼みなら、見たのは Tech Lead 担当なので `roster notify <課題の Key>`）。
- **Staff Engineer 担当は、直さない・決めない。** repo・PR・ページを変えず、merge もしない（書き込みと `git`・`gh` の変える命令は guard が止める）。merge するのは、今までどおり課題の担当。**じかに届くのは、頼みと判定だけ。**そのほかのこと（見る物が読めない・依頼書が足りない）を、課題の担当にじかに聞く道は無い: 判定「見られなかった」で返すか、`roster ask tpm` で TPM 担当に送る。
- **分けた課題では**: repo の席の計画と PR は、その課題の Tech Lead 担当が見る（repo の席の `roster ask review` が、Tech Lead 担当へじかに届く。Staff Engineer 担当の席は起こさない）。Tech Lead 担当は、自分の計画と境の取り決めに照らして見て、Staff Engineer 担当と同じ `roster report review` で返す（返していない頼みがいくつもある時は、`--review <番号>` で名指して返す）。Tech Lead 担当も、レビューでは直さない（直すのは頼んだ席。merge するのも頼んだ席）。Tech Lead 担当自身の計画と PR は、Staff Engineer 担当が見る。「直すべき」を受けない時に TPM 担当へ上げるのは、どちらも同じ。
- **いつ頼むか**: 計画・提案を置く前と、PR を merge する前に、課題の担当が要ると見たら頼む（設計の判断がある・戻しにくい・広く触る、など）。**依頼書に「レビューを受ける」とあれば、計画と PR を必ず頼む。**文書の食い違いだけを直す PR は、頼まなくてよい。
- **残す**: 課題の担当は、成果のページ（計画・結果）に「レビュー: 誰が・判定・どう扱ったか」を必ず書く（レビューのページの URL を添える）。頼まなかった時は「レビュー: 無し」と書く。TPM 担当と Product Manager は、メッセージを受けなくても、この行・課題の記録・置き場のレビューのページ・`roster review list` でレビューを見られる。
- 頼んだ回数・判定・TPM 担当に上げた数は、命令が記録する。`roster review list [--key <Key>]` で読める（この記録も、roster を動かす機械の外に写さない）。
- **席を起こす・閉じる**: 起こすのは `roster ask review`（課題の担当の命令）。席の model と effort は、設定（`.claude/roles/config.jsonc` の `staff-engineer`）で決まる。起こした席が名乗らない時は、課題の担当が `roster ask tpm` で知らせる。返っていない頼みがあるのに席が落ちた時は、次の `roster ask review` が起こし直す（TPM 担当も起こし直せる: 居場所が残っていれば `roster close <課題の Key>.staff` で閉じてから、`roster assign <課題の Key> --role staff-engineer`）。席は、TPM 担当が課題の担当の席を `roster close` で閉じる時に、一緒に閉じる（先に閉じるなら、TPM 担当が `roster close <課題の Key>.staff`。課題の担当は `roster ask tpm` で頼む）。Staff Engineer 担当に【dismiss】は送らず、Staff Engineer 担当は【end】を返さない。

## 連携の 3 つの形

担当どうしの連携は、次の 3 つの形でする（考えは [Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) の連携の決まり Vertical Delegation・Horizontal Consultation・Conflict Resolution から借りた。字は写していない）。

| 形 | 誰と誰 | どの道 |
|---|---|---|
| 縦に任せる | Product Manager → TPM 担当 → 担当（分けた課題では、Tech Lead 担当 → repo の席が続く） | 依頼書と【brief】。成果は【done】で戻る。段を飛ばさない（担当は Product Manager に直接聞かない。TPM 担当は repo を調べず、実装しない。repo の席は、Tech Lead 担当を飛ばして Product Manager への確認を送らない） |
| 横に相談する | 課題の担当 ⇄ その課題の Staff Engineer 担当（repo の席のレビューは、Tech Lead 担当が見る） | 【ask-review】と【review】が、TPM 担当を通らずじかに届く。答えは助言で、相手を縛らない（上の「レビュー」） |
| 食い違いを上げる | 課題の担当 → TPM 担当 →（要れば）Product Manager | 助言を受けない時は自分で決めず、`roster ask tpm --review <番号>` で上げる。決まるまで、ぶつかる所は進めない |

別の課題の担当どうし・DevOps Engineer 担当との横の道は無い（TPM 担当を通る。【ask-tpm】【ask-devops】）。同じ課題の repo の席どうしも、じかには話さない（Tech Lead 担当を通る。【ask-lead】）。

## 課題を読む

課題の Key が Jira（`AI-12`）か GitHub の Issue（`gh-12`）の形なら、課題の題・状態・本文・コメントを `roster issue view <Key>` で読む。

- その Key の道具を宣言した設定が無い project でも読める（設定の `tracker` は `roster` の命令が課題に記録を書くかを決めるだけで、課題は Key の形で道具を選んで読む）。
- `roster hello` が `課題の中身:` の行を返したら、依頼書と一緒に読む。依頼書に Jira や GitHub の URL しか無くても、まずこれで読む。
- 読めなければ、出た誤りのとおりに Key と道具の認証を確かめる。認証が無ければ `roster ask tpm` で、Product Manager に login を頼むことを送る。
- `t-` の Key には課題管理の課題が無い。中身は依頼書にある。
- 課題の写し: Key が読める形なら、`roster assign` が振るたびに課題を読み、写しのページ（`issue-<番号>.html`）を置く。`roster hello` と【brief】が `課題の写し: <URL>` を返したら、依頼書と一緒に読む（振ったときの中身。新しい中身は `roster issue view`）。読めないまま振られたら `課題の写し: 無し（<訳>）` と出る。

### Jira の課題の欄を書く

依頼書が課題の欄を変えることを求めたとき、`acli` に命令の無い欄（コンポーネントなど）は、claude.ai の Atlassian の connector（`mcp__claude_ai_Atlassian_Rovo__editJiraIssue`）で書く。Product Manager の画面の手に回す前に、まず connector で書けるかを当たる。

| connector で書いてよい | connector で書かない（`roster` の命令で書く） |
|---|---|
| 依頼書が変えることを求めた課題の欄: コンポーネント・ラベル・題・本文など | コメント（記録は `roster report …`・`roster ask pm` が書く） |
| | 状態を進める（課題を済みにするのは `roster report end` だけ） |

- guard は Bash の命令だけを見るので、connector のコメントや状態を進める道具は止めない。止められなくても使わない（使うと記録と状態が抜ける）。
- 書いたら、1 件ずつ `roster issue view <Key>` か connector で読み戻して確かめる。
- connector がつながっていなければ（道具が `/mcp` で認証するようにと返したら）、`roster ask tpm` で Product Manager に認証を頼む。認証は 1 度すれば、ほかの担当の session でも使える。
- スペースを作る・課題を別のスペースへ移す・コンポーネントを作るなど、`acli` にも connector にも道具の無い操作は、Product Manager の画面の手になる。手順のページでは、移すと変わる Key でなく、題か古い Key の検索で課題を指す。

## ページ

依頼書・確認・提案・計画・結果・監査は、HTML の file に書いて、roster を動かす機械の置き場（`127.0.0.1` の pagetray。ページを DB に持つサーバーで、起こすのは DevOps Engineer 担当）に置く。置いた物を「ページ」と言う。Artifact tool（publish・read・open）は、依頼書と成果には使わない。

- 置く: `roster page put <file> --kind <brief|confirm|proposal|plan|result|review|audit|issue>`（`review` は Staff Engineer 担当のレビューのページ）。担当の Key は今の課題の Key。TPM 担当は `--key <Key>` を付ける。出た `URL:` を、`roster assign --brief`・`roster ask pm --url`・`roster report done --url` に書く。番号は置き場が決める。同じ種類を置き直すと次の番号になり、前の版は残る。置いた担当の役割と居場所の宛先も、置き場が覚える。
- 読む: `roster page path <URL>` で file の path にして Read tool で読む（roster を動かす機械の控えの path。控えに無ければ置き場から取る。前の置き場の `8800` の URL も読める）。
- 時系列のページ（種類は `timeline`）は、`roster incident timeline` が state の記録から作って置く（下の「思わぬ出来事」）。手では置かない。
- 探す: `roster page list`（今の project の新しい順）。`--key <Key>`・`--role <役割>`・`--workspace <宛先>`・`--kind <種類>`・`--q <語>`・`--reply <waiting|answered>`（返事の状態）・`--on <pm|review|tpm>`（`--reply` の待ちの相手。既定は Product Manager）で絞り、`--json` で記録を出す。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）で同じように絞って見る。
- 開く: ページは自動では開かない（`roster ask pm`・`roster report done` も開かない）。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）を 1 つ開いておき、新着の印で気づいて読む。その場で開いて人に見せる時だけ `roster show <URL>`。
- 返事の状態: Product Manager の返事が要るページ（確認のページ）には、置き場が「返事待ち」「答えた」の状態を持つ。**担当は手で書かない。**`roster ask pm` が、送った確認のページを返事待ちにし、TPM 担当の `roster answer` が答えたにする。Product Manager は、置き場の一覧の UI の「返事待ち N 件」と行の印で、返事が要るページを見分ける。
  - 置いただけの確認のページには印が付かない。`roster ask pm` で送って初めて返事待ちになる。
  - 前の確認を置き換える確認（計画を直して「進むか」を聞き直すなど）は、`roster ask pm --supersede <古い確認の URL>` で送る。送った後、古い確認の返事待ちが外れる（同じ Key の返事待ちの確認だけを受け、別の Key・答え済み・送っていない確認は送る前に断る）。
  - `roster answer` は、その Key の返事待ちのページが 1 枚なら、それを答えたにする。2 枚以上ある時は、送る前に止まって URL を並べるので、どのページへの答えかを `--url <確認の URL>`（何度でも）で書くか、みなへの答えなら `--all` を付けて打ち直す。
  - 置き場が応えない時は、印は付かないが、メッセージは送られる（`置き場の印: 付けていない` と出る）。`roster ask devops` で知らせる（TPM 担当は、DevOps Engineer 担当に振る）。
  - 手で直すのは TPM 担当だけ: `roster page reply <URL>… --waiting|--answered`。`roster answer` を通らずに済んだ確認（取り下げた・次の依頼書で答えた）を答えたにする時と、置き場が応えない間に送った確認を返事待ちにする時に使う。`roster dismiss` は、その Key に返事待ちのページが残っていれば URL を出す。担当は `roster ask tpm` で頼む。
- レビューの印: 置き場は、返事待ちの相手も持つ（Product Manager・レビューの席・TPM 担当）。**担当は手で書かない。**命令が書き、Product Manager の「返事待ち N 件」と `roster answer` の数には入らない。置き場に写すのは、判定の語・見た物の URL・時刻だけ（見てほしい所・判定の一言は写さない）。
  - `roster ask review`（と、席の起こし直し）が、レビューの依頼書に見る物を書いて「レビュー待ち」にする（置き換えた前の依頼書の待ちは外す）。`roster report review` が、レビューのページに判定と見た物を書き、依頼書を「レビュー済み」にする。置き場の一覧の UI は、行に判定の印と「見た物:」の link を、見られたページの行に「レビュー: review-N 判定」を出す。
  - `roster ask tpm --review <番号>` が、レビューのページを「上げた」（TPM 担当の返事待ち）にする。TPM 担当は、決めたら `roster page reply <レビューのページの URL> --answered --on tpm` で「決まった」にする。今の上げた件は `roster page list --reply waiting --on tpm`。
  - 手で直す時（置き場が応えない間に送った頼みなど）は、`roster page reply` に `--on review` か `--on tpm` を付ける（付けないと Product Manager の返事待ちになる）。
- 消す: **消してよいのは TPM 担当だけ**（戻せない。Auditor が置いたページは、Product Manager の言葉を添えなければ TPM 担当も消せない。上の「監査」）。試しに置いた・置き間違えたページは、担当は自分で消さず、`roster ask tpm` で URL と訳を送って頼む（担当の居場所からの `roster page delete` と、置き場に消す要求を直に送る `curl`、置き場の CLI の `pagetray page delete` は止まる）。TPM 担当は `roster page delete <URL>…`（Key ごとなら `--key <Key>`、project ごとなら `--project <名>`。その Key・project の file も一緒に消える）で消す物を見て、`--yes` を付けて消す。控えの file も消える。消したページの URL は 410 を返し、その番号は 2 度使われない。
- 送り手: project に castlist の設定があれば、`roster page put`・`roster file put` は、自分の session を指す付随する id を付けて置く（置き場が castlist に聞き、ページと file の記録に送り手として残す。担当は何も足さない）。置き場が断ると、ページも file も置かれていない（`roster` は送り直さない）。
  - 「castlist に送り手を聞けませんでした（503）」: 置き場が castlist に届かない。castlist が起きてから打ち直す（止まっていれば、下の「アクターの台帳」のとおり guard も止まる）。castlist が起きているのに続く時は、`roster report incident` で台帳に挙げる。
  - 「castlist に登録が無いと、置き場が答えました（400）」: この session が castlist にまだ無い。session は guard が Bash の前に登録するので、打ち直す。続く時は `roster report incident` で台帳に挙げる。
- 置き場が応えなければ、ページは置けない（`roster page put` が止まる。番号を置き場が決めるため）。控えにあるページは読める。`roster ask devops --what "置き場（pagetray）を起こす" --why "<何が置けないか>"` で頼む。自分では container を起こさない。
- 図: Product Manager が読むページには、下の図を入れる。描く図はページの中に inline の SVG で描く（file に上げない。字で描くので、画面の写しのような写り込みが無い）。file で上げるのは画面の写しだけ。ひな形と描き方は、この folder の `figures.md`。

  | ページ | 入れる図 |
  |---|---|
  | 確認 | 項目ごとに、選ぶ問いの木を 1 つ（Product Manager が答えれば選択肢が決まる問いを 1〜2 つ並べ、書き手の見立ての道を色で示す）。性質の比べは表に任せる。Product Manager が答えて選びが決まる問いが無い項目（2 択で違いが 1 つ・違いが技術の差だけ、など）は図を入れず、訳を 1 行 |
  | 提案 | 案を選ぶ問いの木（確認と同じ形）。案がどこに効くか・何を変えるかの流れの図 |
  | 計画 | 今と後（前と後）か、段の流れ |
  | 結果 | 変えた所の前と後。画面を変えたなら、画面の写しを `roster file put` で上げる |
  | 監査 | 指摘の数の推移と、勧告ごとの並べ（`figures.md` の「5. 並べ」） |
  | 依頼書 | 要る所だけ（読むのは担当） |

  - 図を入れないページには、入れない訳を頭に 1 行書く（例: 「図: 無し。変えたのは文 1 行だけ」）。
  - 図の中の字は SVG の text で書き（画像の中の字にしない）、`role="img"` と `aria-label` を付ける。色は明るい画面と暗い画面の両方で読めるように、ひな形の色の変数を使う。
- file（画像・PDF・字の file）: ページに付ける画面の写し・図・log は、置き場に上げて、ページから相対で参照する。受けるのは png・jpg・jpeg・gif・webp・pdf・txt・log・md・csv・json で、1 つ 16 MiB まで（動画・HTML・SVG は受けない）。
  - 上げる: `roster file put <file> --reviewed`（TPM 担当は `--key <Key>` も）。画像と PDF は、上げる前に Read tool で見て、token・鍵・個人の情報・ほかの人の画面・roster を動かす機械の path が写っていないか確かめる（`--reviewed` が無いと止まる）。字の file は秘密の形を走査し、当たれば行の番号を出して止まる。置き場での名は元の名から作り（`--name <語>.<拡張子>` で替えられる）、番号は置き場が付ける。同じ名で上げ直すと次の番号になり、前の物は残る。
  - ページには、出た `ページからの参照:` の形で相対に書く（同じ Key なら `<img src="files/<語>-<n>.<拡張子>">`、別の Key なら `../<Key>/files/…`）。置き場でも控えでも同じ形で開く。
  - 読む: `roster file path <URL>` で file の path にして Read tool で読む。`roster page path` も、ページが参照する file を控えに写し、`参照の file:` の行に path を出す。探すのは `roster file list`。
  - 消す: ページと同じく TPM 担当だけ。担当は `roster ask tpm` で URL と訳を送って頼む（秘密を上げてしまった時は、すぐ）。TPM 担当は `roster file delete <URL>…` で消す物と、それを参照しているページを見て、`--yes` を付けて消す。
  - 「置き場が、この roster の呼ぶ操作を持たない」と出たら（ページも file も同じ）、`roster ask devops` で置き場を `.pagetray-version` の版で起こし直すよう頼む。

## Product Manager に確かめる

文書やコメントの食い違い**以外**で Product Manager に決めてほしいことは、確認のページに書いて【ask-pm】で送る。課題管理の課題があってもなくても同じ。

1. 確認のページを HTML の file に書く。項目ごとに、背景・選択肢・お勧めとその訳を書き、選択肢を表に、選ぶ時の問い（Product Manager が答えれば決まる物）を図にする（図は上の「ページ」の図の項）。
2. `roster page put <file> --kind confirm` で置く（上の「ページ」）。
3. 出た URL で `roster ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` を打つ。TPM 担当に【ask-pm】が行き、状態が `回答待ち(PM): <何を>` になり、置き場の確認のページが返事待ちになる（上の「ページ」の返事の状態）。**前の確認（まだ返事待ちの物）を置き換えるなら、必ず `--supersede <古い確認の URL>` で名指す**（何度でも）。名指した確認の返事待ちが外れる。名指さないと、答える要の無い確認が Product Manager の画面の「返事待ち」に残り続ける（2026-11-22 の t-23zs の confirm-14）。
4. 答えは【answer】で来る。

## 文書の食い違い

文書やコメントの食い違いを見つけた時にすることは、担当で違う。

| 担当 | すること |
|---|---|
| TPM 担当 | 自分で直さず、課題として Software Engineer 担当に回す（`/tpm` の 2） |
| Staff Engineer 担当 | **直さない。**レビューのページの指摘に挙げる。直すのは、課題の担当 |
| Software Engineer 担当・Tech Lead 担当・DevOps Engineer 担当・Sustaining Engineer 担当 | お勧めの直し方で直し、PR を merge まで自分で進める（Product Manager の確認は要らない）。worktree で作業し、PR の題か本文に課題の Key を入れる。merge したら【doc-fix】で知らせ、成果のページにも一覧で載せる |
| Auditor | **直さない。**監査のページの「見つけた食い違い」に、file・今の文・コードの実際・お勧めの直し方を挙げる。Product Manager が通せば、TPM 担当が課題にして振る |

文書とコードが食い違うときは、コードの方に合わせる。

## 共有の環境

環境（container・サーバーなど）を変えてよいかは、project の設定に書いた手続きで決まる。`roster infra list` が環境と手続きを出す（直下の folder の設定の宣言も合わせた物。どの folder で打った命令にも効く）。

| 手続き | 困る人 | 変えてよい担当 | 先に要ること |
|---|---|---|---|
| 自由 | 自分だけ | どの担当も | 無し |
| TPM に相談 | 並べて動いているほかの担当 | DevOps Engineer 担当だけ | 【ask-tpm】で何が止まるかとお勧めを送り、答えを待つ |
| PM の承認 | ほかの人・ほかのチーム | DevOps Engineer 担当だけ | 【ask-pm】で承認を取る。承認は時間を限って効く |
| PM だけ | Product Manager が自分の手に取っておく物 | どの担当も打てない（TPM 担当・DevOps Engineer 担当も。承認も書けない） | 打ってほしい 1 行と訳を確認のページに書き、【ask-pm】で送る。Product Manager が自分の terminal で直に打つ |

- 自分が変えてよくない環境は、自分では変えず【ask-devops】で TPM 担当に送る。
- 手続きを踏んでいない命令は、guard が実行の前に止める。止まったら、出た文のとおりに頼む（別の書き方で通そうとしない）。
- 名を書かずに container を選ぶ命令（`--all`・`-a`・`$(…)`・xargs・変数・glob と、`system stop`・`prune`）は、共有の環境にみな当たるとみなして止まる（castlist にも当たるので、どの担当も打てない）。自分の使い捨ての container は、`container ls` で名を見て、名を書いて打つ。
- process を止めるときは、`pgrep -fl '<型>'` で pid と command line を見て、当たった数を確かめてから、その数字を `kill <pid>` に書く。`pkill`・`killall` と pid を名指さない `kill`（`xargs kill`・`kill $(pgrep …)`）は打たない（guard が止める。macOS の `pkill` は後ろの旗も pattern に読み、2026-11-23 の朝（JST）に担当の session ごと 29 個を止めた。台帳 #89）。
- 設定に書かれていない環境で、並べて動いている担当やほかの人が困りそうな物を変えるときも、先に【ask-tpm】を送る。
- 手元で image を build する builder（環境 `builder`。container の名は `buildkit`）は、どの担当も使う。`container build` はそのまま打つ（builder が止まっていれば build が起こす）。build に `-c`・`-m`・`--ssh`・`--dns…` を付けない（動いている builder を作り直し、ほかの担当の build が落ちる。guard はこれを止められない）。要るなら【ask-devops】。

## 待つ・見張る

GitHub の側が終わるのを待つ仕事（PR の CI・merge の後の main の workflow・GitHub の戻り）は、自分（model）で待たず、見張りの命令 `roster watch` に任せる。待つ間、トークンを使わず、メッセージも届く。

| 待つ物 | 命令 | 既定の長さ |
|---|---|---|
| PR の CI（今の head の commit の check が、みな終わるまで） | `roster watch pr <PR の URL>` | 30 分 |
| merge の後の main の workflow | `roster watch main <PR の URL>` | 30 分 |
| GitHub が応えるようになるまで | `roster watch github [--repo <owner/repo>]` | 120 分 |

- **裏で起こして、手を止める。**Bash の `run_in_background` で打つ（表で打つと、終わるまで手が塞がり、メッセージが届かない）。命令が終わると起こされ、終了コードが渡る。**通ったかは、終了コードで決める**: 0 = 通った（戻った）・10 = 落ちた・20 = まだ（長さを過ぎた）・30 = check や回が付いていない・1 = 見張れない。0 のほかは、出力の file を読む（落ちた check の名と URL が出ている）。
- **30 は「通った」ではない。**check が付いていないだけ。repo に、PR で動く workflow が在るなら、もう 1 度見張る。無い repo なら、そう確かめてから進む。
- 20（まだ）で終わったら、もう 1 度見張る。2 度続けて過ぎたら、`roster ask tpm` で知らせる。
- 今の様子を 1 回だけ見るなら `--timeout 0`（待たずに終わる）。
- `gh pr checks --watch`・`gh run watch`・`sleep` で待たない。check の数でも待たない。例外は 1 つ: main で落ちた workflow を `gh workflow run` で流し直した回は、新しい回が作られたのを `createdAt` で確かめてから、`gh run watch <回の id> --exit-status` を裏で起こして待つ（表で打たない。打ってすぐの `roster watch main` は、前の落ちた回を見て終わる。手順は `/software-engineer` の 2）。
- **GitHub が応えない時**: `gh`・`git push`・`git fetch` が、5xx や繋がらない誤りで落ちたら、打ち直しを続けない。`roster watch github --repo <落ちた手の owner/repo>` を裏で起こして手を止め、「戻った」（0）で起こされてから、落ちた命令を打ち直す。GitHub の障害は一部だけのことが多く、「戻った」の後も merge・push がまだ落ちることがある。打ち直しがまた落ちたら、もう 1 度見張る。20 で終わったら `roster ask tpm` で知らせる（既定で 2 時間待った後なので、1 度で知らせる）。PR の CI を見張っている間に GitHub が落ちた時は、`roster watch pr` が聞き直し続けるので、何もしなくてよい。
- merge したら、先に `roster watch main <PR の URL>` を裏で起こして待ち、終わってから `roster report merged`（`roster report doc-fix`）を打つ。命令も、merge の後の main の workflow を見て、結果を本文に足す。merge から 2 分の内と、まだ動いている回がある間は、止まる（落ちた回がもう在っても。みな終わってから送る）。止まったら、`roster watch main <PR の URL>` を裏で起こして待ち、終わってから打ち直す。`--unchecked` は、merge の確かめも main の workflow の確かめも外すので、`gh` で読めない PR の時だけ使う。

## アクターの台帳（castlist）

project の設定に castlist（アクターの台帳）の URL があれば、`roster` が、自分の session の始まり・終わり・名乗り・model と effort を castlist に送る（hook と命令が送るので、担当は何も打たない）。

- 設定が無ければ何も送らず、`roster start` と `roster hello` が「⚠ 警告: castlist（アクターの台帳）を設定していません」の枠を出す（止めない）。担当は何もしなくてよい（TPM 担当が Product Manager に伝える）。

- `roster hello` の出力の頭に `アクター: <名>`（`t-23zs-swe.1` など）が出る。結果のページや報告で自分を名指す時は、この名を使ってよい。
- castlist が止まっていると、`roster hello` は名乗らずに止まり、guard は Bash を止める。どちらも、Product Manager が自分の terminal で打つ 1 行（`container start castlist.box` か `container run …`。0.1.0 の名 `castlist` で動いている間は、その名の `container start`）を出す。その 1 行は自分で打たない（castlist を起こすのは Product Manager だけ。guard も止める）。Bash が止まると `roster` の命令も打てないので、TPM 担当はその 1 行を返答に書いて Product Manager に頼み（打てれば `roster wait pm "castlist を起こす" --hand`）、担当はその 1 行を返答に書いて止まる（TPM 担当の Bash も同じく止まるので、Product Manager が起こした後に、TPM 担当が `roster notify` で打ち直すよう伝える）。起きたら、止まった命令を打ち直す。
- castlist の時計がずれていると 1 行出る（止まらない）。出たら `roster report incident` で台帳に挙げる。

## 終わり方

- Software Engineer 担当・Tech Lead 担当・DevOps Engineer 担当は、依頼書 1 つが済むごとに【done】を送り、次の【brief】を待つ。同じ課題の続きは同じ担当が受ける。【dismiss】が来るまで自分から終えない（`roster report end` は【dismiss】の前には送れない）。
- 自分の居場所（workspace）は自分で閉じない。【end】を送った後、TPM 担当が報告を受けてから閉じる。
- 分けた課題: repo の席の【dismiss】は Tech Lead 担当が送り、repo の席の【end】は Tech Lead 担当へ届く（課題管理の課題は済みにならない）。席は Tech Lead 担当が `roster seat close` で閉じる。Tech Lead 担当は、repo の席をみな閉じてから【end】を送る（残っていれば、命令が断る）。課題が済みになるのは、Tech Lead 担当の【end】。
- 自分で作った worktree と branch は、merge の後に消す（`git worktree list` に本体だけが残ること）。
- Staff Engineer 担当は、レビューを【review】で課題の担当へ返し、次の頼み（【ask-review】）を待つ。【done】も【end】も送らない。席は、TPM 担当が課題の担当の席と一緒に閉じる（上の「レビュー」）。
- Auditor の席は、Product Manager が起こし、閉じる。【done】も【end】も送らず、報告と決定の後は次の `/audit` を待つ。
