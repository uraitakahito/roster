# 担当のあいだの決まり（どの担当も読む）

TPM 担当（`/tpm`）・Software Engineer 担当（`/software-engineer`）・DevOps Engineer 担当（`/devops-engineer`）・Staff Engineer 担当（`/staff-engineer`）・Sustaining Engineer 担当（`/sustaining-engineer`）・Auditor（`/audit`）が共通に従う決まり。依頼主は Product Manager（利用者）。返答と報告は日本語で書く。

担当どうしのやりとりは、すべて `tpm` の命令でする。`tpm` が、メッセージを送る・届いたかを見る・課題に記録を書く・状態を出す、を 1 度にする。連携の道具（cmux など）の命令と、課題管理の道具（Jira・GitHub の Issue）で記録を書く・状態を進める命令は直に打たない（直に打つと記録と状態が抜けるので、guard が止める）。課題管理の課題を読む命令は止めないが、読むときも `tpm issue view` を使う（下の「課題を読む」）。どの道具を使うかは、TPM 担当を起こした folder と、その直下の folder の `.claude/roles/config.jsonc` を合わせた設定で決まる（下の repo をいくつも触る課題のため。課題の記録の先は、課題の Key の形で決まる）。

## 連絡の仕方

- メッセージは、下の「見出し」の表の命令で送る。命令は「届いた」か「まだ届いていない」を返す。相手が手を動かしている間は届かず、空いたら届くので、送り直さない。
- メッセージは、手が空いた時に画面に届く。段の区切り（PR を出す前・merge を頼む前）と、戻せない手（tag を打つ・release を出す・消す）の前には `tpm inbox` で、まだ届いていない自分宛てのメッセージを見る。
- メッセージを送る命令は、送る前に受信箱を見る。送る相手から来て、まだ読んでいないメッセージがあれば、それを出して 1 度止まる（送っていない。課題の記録も書いていない）。読んで、同じ命令を打ち直す。届いたメッセージで事情が変わっていたら、中身を変えて打つ。`tpm page put` も、確認・提案・計画・結果・レビューのページ（`--kind confirm|proposal|plan|result|review`）は、置く前に同じように見て 1 度止まる（置いていない）。事情が変わっていたら、ページを書き直して置く。
- **打ち直しは、止まったのを見てから別の回に打つ。**`;` や `||` で 1 行に続けて書かない（止まらなかった時にも 2 度目が動く）。同じメッセージを 30 秒の内に 2 度送ろうとすると、命令は 2 度目を送らずに止まる。
- 届いたメッセージには id が付いている。そのメッセージへの返事は `--reply-to <id>` を付けて送る。
- 宛先は書かない。担当のメッセージは TPM 担当へ行き、TPM 担当は課題の Key で担当を名指す。**レビューの頼みと判定だけは、TPM 担当を通らない**: 命令が、課題の担当と、その課題の Staff Engineer 担当の席の間を、じかに届ける（下の「レビュー」）。
- **Product Manager に直接聞かない。** Product Manager とのやりとりは、すべて TPM 担当を通す。例外は Auditor だけ: Product Manager が起こした `Audit` の席で、Product Manager とじかに話す（下の「監査」）。
- 命令の使い方は `tpm <命令> --help`。命令が誤りで止まったら、出た文に従って直す（道具の命令に替えて先へ進まない）。

## 見出し

### TPM 担当へ

| 見出し | いつ | 命令 |
|---|---|---|
| 【ask-tpm】 | TPM 担当に決めてほしいことがある（レビューの判定を受けずに上げる時は、`--review <頼みの番号>` を付ける。下の「レビュー」） | `tpm ask tpm "<困っていること・試したこと・案とお勧め>" --waiting-for "<何を>" [--review <番号>]` |
| 【ask-pm】 | Product Manager に決めてほしいこと・頼むことを確認のページに書いて置いた（下の「Product Manager に確かめる」） | `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>" [--supersede <置き換える古い確認の URL>…]` |
| 【ask-devops】 | 共有の環境で DevOps Engineer 担当の手が要る（下の「共有の環境」） | `tpm ask devops --what "<何を>" --why "<なぜ>" [--urgent]` |
| 【doc-fix】 | 文書やコメントの食い違いを直した PR を merge した | `tpm report doc-fix --pr <URL> --note "<一言>" [--unchecked "<訳>"]` |
| 【incident】 | 思わぬ出来事（信頼性・安全性・効率性が落ちた）に気づいた（下の「思わぬ出来事」） | `tpm report incident "<起きた事実>" --type <reliability\|safety\|efficiency> [--tag <tag>] [--severe]` |
| 【merged】 | 自分の PR を 1 本 merge した | `tpm report merged --pr <URL> --note "<一言>" [--unchecked "<訳>"]` |
| 【done】 | 依頼書の成果（提案・計画・結果・監査のページ）を置いた | `tpm report done --url <URL> --kind <proposal\|plan\|result\|audit> --summary "<要点>" --remaining "<残り>" --decisions "<決めてほしいこと>"` |
| 【end】 | 【dismiss】を受けて片付けた（Sustaining Engineer 担当は PR を merge した後） | `tpm report end --url <URL> --pr <URL> … --removed <worktree> … --left "<残っている物>"` |

- 【done】の「残り」は、依頼の外で直すとよい物・やらなかった物・merge していない PR。「決めてほしいこと」は、【ask-pm】で送った項目の題。どちらも無ければ「なし」と書く（書かないと送れない）。TPM 担当はこの 2 つで【dismiss】を送るかを決める。
- 【end】の「残っている物」は、計画から外れた物・残した物で直した方がよい物。無ければ「なし」。
- 【merged】【doc-fix】と【end】の `--pr` は、命令が送る前に PR が merge 済みか（`gh pr view` の state が `MERGED`）を見る。merge していなければ送らずに止まるので、merge を確かめてから打ち直す。`gh` で読めない PR だけ、自分で確かめた方法を `--unchecked "<訳>"` に書いて送る（訳はメッセージに載る）。

Dependabot の PR だけで使う見出し（【merge-request】【not-yet】【recreated】）は `/sustaining-engineer` と `/dependabot-triage` に書いてある。

Staff Engineer 担当は、【done】【end】【merged】【doc-fix】【ask-pm】【ask-review】を送らない（命令が断る）。成果は、下の【review】で課題の担当へじかに返す。

### 担当から担当へ（レビューだけ。TPM 担当を通らない）

| 見出し | 誰から誰へ | いつ | 命令 |
|---|---|---|---|
| 【ask-review】 | 課題の担当 → その課題の Staff Engineer 担当の席 | 計画・提案のページか PR を見てほしい（下の「レビュー」）。席が無ければ、命令が席を起こして依頼書で渡す（その時、メッセージは無い） | `tpm ask review --url <見る物の URL> [--focus "<見てほしい所>"]` |
| 【review】 | Staff Engineer 担当 → 頼んだ課題の担当 | レビューのページと判定を返す | `tpm report review --url <レビューのページの URL> --verdict <判定> --summary "<一言>"` |

宛先は、どちらも命令が名簿から引く（書かない）。送り手の名は、命令が名簿の題から付ける。

Auditor（監査の担当。Product Manager が起こす `Audit` の席）だけが使う見出しは 2 つ。【audit】は、Product Manager へじかに出した監査の報告の写し（`tpm report audit`）。【decided】は、Product Manager の決定（`tpm report decided`）。Auditor は、【done】【end】【merged】【doc-fix】【ask-pm】【ask-review】を送らない（下の「監査」）。

### TPM 担当から

| 見出し | 中身 | 命令（TPM 担当が打つ） |
|---|---|---|
| 【brief】 | 新しい依頼書の URL（Staff Engineer 担当への依頼書は、レビューの頼みから命令が作る）。下の「ページ」のとおり読み、それに従う。「取り消す: brief-N」とあれば brief-N の作業をやめてこちらに従い、「brief-N を済ませてから、これをする」とあれば brief-N の【done】の後に始める | `tpm assign <Key> --role <役割> --brief <URL> [--supersede\|--after]` |
| 【answer】 | Product Manager の答え。待ちの表示を作業中に戻して続ける | `tpm answer <Key> "<答え>" [--url <確認の URL>…\|--all]` |
| 【notify】 | 知っておくこと・受け取ったという返事。返事は要らない | `tpm notify <Key> "<本文>"` |
| 【dismiss】 | この課題に続きは無い（Product Manager が決めたか、TPM 担当が聞かなくてよいと決めた）。worktree を片付けて【end】を返す。担当の交代のためなら、そう書いてある。「取り消す: brief-N」とあれば brief-N の作業もやめる | `tpm dismiss <Key> [--handover] [--supersede]` |

この表の命令と `tpm close` は、担当の session から打つと断られる（送り手の名は命令が付けるので、担当が打つと TPM 担当の名で届いてしまう）。TPM 担当に頼むことは `tpm ask tpm` で送る。

## 状態

- 出すのは **`model` と `wait` の 2 つだけ**。`model` は名乗ったとき（`tpm hello`）に出る。
- `wait`: 「今、誰が何を待っているか」を 1 つだけ。状況が変わるたびに上書きする。
  - 自分が動いている: `tpm wait work "<段>"`（`作業中: <段>`）
  - Product Manager の答えを待つ: `tpm wait pm "<何を>"`（`回答待ち(PM): <何を>`）。TPM 担当が Product Manager に手の操作を頼んで待つ回は `--hand` を付ける（下の「思わぬ出来事」）
  - TPM 担当の答えを待つ: `tpm wait tpm "<何を>"`（`回答待ち(TPM): <何を>`）
  - レビューの相手を待つ: `回答待ち(レビュー): <何を>`（`tpm ask review`・`tpm report review` が出す。手では打たない）
  - 待つ時間に限りがあれば添える: `tpm wait tpm "merge（14:30 まで）"`
- `tpm wait` は打った時刻も覚える。Product Manager への通知のバナーは、TPM 担当が**その回に** `tpm wait pm` を打って手を止めた時に出る（設定は docs の「設定」の「通知のバナー」）。
- やりとりの命令は、メッセージを送った後の待ちも出す（`tpm ask …` は回答待ち、`tpm ask review` は `回答待ち(レビュー): <見る物>`、`tpm report done` は `回答待ち(TPM): 次の依頼`、`tpm report end` は `回答待ち(TPM): workspace を閉じる`）。答えが来たら `tpm wait work "<段>"` に戻す。
- **`/model`・`/effort` は打たない**（新しい session の既定まで書き換わる）。model と effort は起動の旗で決まる。

## 記録

課題管理の課題（`tpm hello` が返す「課題管理の課題」）があれば、やりとりの命令のうち下の表の物が、課題にコメントを 1 件書く。課題が無い・課題管理を使わない project では何も書かない。担当が自分で課題にコメントを書いたり、状態を進めたりはしない。

| 命令 | 書く記録（1 行目は `【<種類>】<担当>: <一言>`） |
|---|---|
| `tpm report done --kind <種類>` | `提案`・`計画`・`結果`・`監査`（`--kind` の `proposal`・`plan`・`result`・`audit`）。成果の URL と、`--point` の要点（3 つまで） |
| `tpm report doc-fix` | `文書の修正`。PR の URL |
| `tpm report review` | `レビュー`。レビューのページの URL と、判定 |
| `tpm ask pm` | `確認`。確認のページの URL と、項目の題 |
| `tpm answer`（TPM 担当） | `決定`。【answer】を返す前に書かれる |
| `tpm report end` | `結果`。続けて課題を済みにする（担当の交代の【dismiss】のときは済みにしない） |

- 中身はページに書き、記録には写さない。
- GitHub の Issue を使う project では、PR の題か本文に課題の Key を書くとき `Refs #12` と書く。`Closes #12` と書くと merge で勝手に閉じ、【dismiss】で閉じる決まりとずれる。

## 思わぬ出来事

担当の仕組み（`tpm`・skill・この決まり・ページの置き場）で思わぬことが起きたら、気づいた担当が、その場で台帳に 1 行書く。書くのは事実だけ（何が起きたか）。原因はその場で調べず、仕事を続ける。後で Auditor が見直し、調べる（下の「監査」）。

| 種類（`--type`） | 例 |
|---|---|
| `reliability`（信頼性） | うその知らせを送った・行き違い（答えが届く前に先へ進んだ）・誰のしたことか分からない変化・計画や依頼書の誤り |
| `safety`（安全性） | 公開や削除が計画と違った・守り（guard・手続き）をすり抜けた・戻せない手を確かめずに打った |
| `efficiency`（効率性） | 権限が足りず人の手が要った・同じことを 2 度した・長く待たされた |

- 担当は `tpm report incident "<起きた事実>" --type <種類>`（TPM 担当に【incident】が行く）。**自分の誤りも書く。**
- session の権限で断られた命令は、`--tag 権限` を付けて書く。別の書き方で通そうとしない。
- すぐ止めないと害が広がる物は `--severe` を付ける。TPM 担当が、すぐ Product Manager に伝える（監査を呼ぶかは Product Manager が決める）。
- 【done】の「残り」と【end】の「残っている物」は、「なし」でなければ命令が台帳に入れる（書き直さなくてよい）。【end】の「残っている物」は、同じ Key の未決の【done】の「残り」があれば、その件に寄せる（新しい件にしない）。TPM 担当が Product Manager に手の操作を頼んだ回（`tpm wait pm "<何を>" --hand`）も入る。前の wait がその頼みのまま打ち直した `--hand` は、前の件に寄せる。この 2 つ（種類の無い件）は、TPM 担当が扱う（振る・調べない・済み）。
- `tpm incident timeline <件の番号|課題の Key>` が、その前後の記録（メッセージと届いた時刻・課題管理への書き込み・guard と入口の検査が止めた回・`wait` の移り）を時刻の順に 1 枚のページにして置く。届く前に相手が次を送った所には「行き違い」の印が付く。原因を調べる Auditor が読む。
- 原因の調べと、種類のある件（出来事）の扱い（調べない・済み）を決めるのは、Auditor（下の「監査」）。TPM 担当は出来事を「調べない」「済み」にできない（命令が断る）。振り先を結ぶ・tag を足すことはできる。
- TPM 担当は `tpm incident add <Key> "<起きた事実>" --type <種類>` で書く。見直す・扱いを決める命令（`tpm incident review` など）は、TPM 担当と Auditor のほかの担当からは打てない。
- **台帳・送ったメッセージの記録（state の `*.jsonl`）は、メッセージや命令の字を持つ。tpm を動かす機械の外（課題管理のコメント・PR の本文・公開の site）に写さない。**【incident】は課題管理に記録を書かない。

## 監査

担当の仕組みが、信頼でき、安全で、むだなく回っているかは、Auditor が調べる。Auditor は TPM 担当の回し方も見るので、監査は TPM 担当の手を通らない。何のために・どこまで・誰に、は監査の規程（この folder の `audit-charter.md`。Product Manager が承認した物）にあり、どの担当もそれに従う。

- **始めるのは、いつも Product Manager。** Product Manager が `tpm audit start` で `Audit` の席を起こし、その席で `/audit`（定期の監査。目安は週 1）か `/audit <件の番号…>`（臨時の監査）を呼ぶ。自動では始まらない。
- **報告は Product Manager へじかに。** Auditor は監査のページを置き、`Audit` の席で Product Manager に報告する。TPM 担当には写し（【audit】）が行く。Product Manager はその席で答え、Auditor が決定を TPM 担当に渡す（【decided】）。
- **TPM 担当**は、【audit】を伝え直さない。【decided】の「する」の勧告を、いつもの課題として担当に振り、`tpm incident assign <番号>… --to <振り先の Key>` で件に結ぶ。Auditor からの【ask-tpm】（事実の確かめ）には、知っていることを答える。
- **TPM 担当とほかの担当は、監査を止めない・範囲を狭めない。** `Audit` の席を起こさない・閉じない（`tpm audit start` を打つのは Product Manager。`tpm assign`・`tpm dismiss`・`tpm close` は、この席を断る）。Auditor の置いたページを消さない（消す訳があれば、Product Manager の言葉を `tpm page delete … --pm "<言葉>"` に添える。記録に残る）。
- **Auditor は直さない・決めない。** repo・設定・環境を変えず、PR を出さず、課題を振らず、課題管理に書かない（書き込みと `git`・`gh` の変える命令は guard が止める）。どの改善をするか・受け入れるかは Product Manager が決める。
- Auditor の席に、依頼書・【dismiss】・【end】は無い。席は Product Manager が閉じる。

## レビュー

計画・提案・PR を、書いた者から離れた目で見るのは、Staff Engineer 担当。課題ごとに、課題の担当の隣に席が立つ（名簿の Key は `<課題の Key>.staff`、居場所の題は `レビュー <課題の Key>: <見る物>`（`PR #180`・`計画 plan-2` など）。題の下の説明は見てほしい所で、席の左の端に紫の帯が付く。題と説明は、命令が頼みのたびに替える）。**頼みと判定は、TPM 担当を通らず、課題の担当と席の間をじかに届く。**

1. **頼む**（課題の担当）: `tpm ask review --url <見る物の URL> [--focus "<見てほしい所>"]`。見る物は、置き場のページ（計画・提案）か PR の URL。命令が、頼みから席への依頼書を作って置き、**席が無ければ起こし**（名乗るまで待つ。90 秒まで）、**居れば【ask-review】を席へじかに送る**（見直しは、前の指摘を知る同じ席がする。前の頼みがまだ返っていなければ、その後ろに積まれる）。状態が `回答待ち(レビュー): <見る物>` になる。待つ間、レビューに依らない作業は続けてよい。
2. **見て返す**（Staff Engineer 担当）: レビューのページを置き（`tpm page put <file> --kind review`。課題の Key の folder に入る）、`tpm report review` で返す。【review】が、頼んだ課題の担当へじかに届き、課題があれば「レビュー」の記録が書かれる。
3. **扱う**（課題の担当）: レビューのページを読み、指摘を自分で確かめてから扱う。

| 判定 | 意味 | 課題の担当のすること |
|---|---|---|
| よい（`approve`） | このまま進めてよい | 進む |
| 気になる所あり（`concerns`） | 直した方がよい所がある | 指摘ごとに、直す・直さない（訳）を決めて進む |
| 直すべき（`reject`） | このまま進めると害がある | 直して、見直しを頼む（もう 1 度 `tpm ask review`）。受けないなら、自分で決めずに TPM 担当に上げる（下） |
| 見られなかった（`not-assessed`） | 材料が足りない・読めない | 足りない物を足して、頼み直す |

- **レビューは助言で、課題の担当を縛らない。** 受けるか・直すかは課題の担当が決める。
- **意見がぶつかった時だけ、TPM 担当に上げる。** 課題の担当が「直すべき」を受けない時は、自分で決めず、`tpm ask tpm "<受けない訳・案とお勧め>" --waiting-for "<何を>" --review <頼みの番号>` で上げる（TPM 担当は判定を受け取っていないので、命令がレビューのページの URL を本文に足し、上げたことを頼みの記録に残す。`--review` が受けるのは、自分の課題の、判定が「直すべき」の頼みだけ）。決まるまで、その PR は merge しない。TPM 担当は、依頼書と Product Manager の言葉で決まる物は自分で決め、範囲・優先・設計の好みは Product Manager に聞く。レビューの担当に伝えることがあれば、TPM 担当が `tpm notify <課題の Key>.staff` で伝える。
- **Staff Engineer 担当は、直さない・決めない。** repo・PR・ページを変えず、merge もしない（書き込みと `git`・`gh` の変える命令は guard が止める）。merge するのは、今までどおり課題の担当。**じかに届くのは、頼みと判定だけ。**そのほかのこと（見る物が読めない・依頼書が足りない）を、課題の担当にじかに聞く道は無い: 判定「見られなかった」で返すか、`tpm ask tpm` で TPM 担当に送る。
- **いつ頼むか**: 計画・提案を置く前と、PR を merge する前に、課題の担当が要ると見たら頼む（設計の判断がある・戻しにくい・広く触る、など）。**依頼書に「レビューを受ける」とあれば、計画と PR を必ず頼む。**文書の食い違いだけを直す PR は、頼まなくてよい。
- **残す**: 課題の担当は、成果のページ（計画・結果）に「レビュー: 誰が・判定・どう扱ったか」を必ず書く（レビューのページの URL を添える）。頼まなかった時は「レビュー: 無し」と書く。TPM 担当と Product Manager は、メッセージを受けなくても、この行・課題の記録・置き場のレビューのページ・`tpm review list` でレビューを見られる。
- 頼んだ回数・判定・TPM 担当に上げた数は、命令が記録する。`tpm review list [--key <Key>]` で読める（この記録も、tpm を動かす機械の外に写さない）。
- **席を起こす・閉じる**: 起こすのは `tpm ask review`（課題の担当の命令）。席の model と effort は、設定（`.claude/roles/config.jsonc` の `staff-engineer`）で決まる。起こした席が名乗らない時は、課題の担当が `tpm ask tpm` で知らせる。返っていない頼みがあるのに席が落ちた時は、次の `tpm ask review` が起こし直す（TPM 担当も起こし直せる: 居場所が残っていれば `tpm close <課題の Key>.staff` で閉じてから、`tpm assign <課題の Key> --role staff-engineer`）。席は、TPM 担当が課題の担当の席を `tpm close` で閉じる時に、一緒に閉じる（先に閉じるなら、TPM 担当が `tpm close <課題の Key>.staff`。課題の担当は `tpm ask tpm` で頼む）。Staff Engineer 担当に【dismiss】は送らず、Staff Engineer 担当は【end】を返さない。

## 連携の 3 つの形

担当どうしの連携は、次の 3 つの形でする（考えは [Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) の連携の決まり Vertical Delegation・Horizontal Consultation・Conflict Resolution から借りた。字は写していない）。

| 形 | 誰と誰 | どの道 |
|---|---|---|
| 縦に任せる | Product Manager → TPM 担当 → 担当 | 依頼書と【brief】。成果は【done】で戻る。段を飛ばさない（担当は Product Manager に直接聞かない。TPM 担当は repo を調べず、実装しない） |
| 横に相談する | 課題の担当 ⇄ その課題の Staff Engineer 担当 | 【ask-review】と【review】が、TPM 担当を通らずじかに届く。答えは助言で、相手を縛らない（上の「レビュー」） |
| 食い違いを上げる | 課題の担当 → TPM 担当 →（要れば）Product Manager | 助言を受けない時は自分で決めず、`tpm ask tpm --review <番号>` で上げる。決まるまで、ぶつかる所は進めない |

別の課題の担当どうし・DevOps Engineer 担当との横の道は無い（TPM 担当を通る。【ask-tpm】【ask-devops】）。

## 課題を読む

課題の Key が Jira（`AI-12`）か GitHub の Issue（`gh-12`）の形なら、課題の題・状態・本文・コメントを `tpm issue view <Key>` で読む。

- その Key の道具を宣言した設定が無い project でも読める（設定の `tracker` は `tpm` の命令が課題に記録を書くかを決めるだけで、課題は Key の形で道具を選んで読む）。
- `tpm hello` が `課題の中身:` の行を返したら、依頼書と一緒に読む。依頼書に Jira や GitHub の URL しか無くても、まずこれで読む。
- 読めなければ、出た誤りのとおりに Key と道具の認証を確かめる。認証が無ければ `tpm ask tpm` で、Product Manager に login を頼むことを送る。
- `t-` の Key には課題管理の課題が無い。中身は依頼書にある。
- 課題の写し: Key が読める形なら、`tpm assign` が振るたびに課題を読み、写しのページ（`issue-<番号>.html`）を置く。`tpm hello` と【brief】が `課題の写し: <URL>` を返したら、依頼書と一緒に読む（振ったときの中身。新しい中身は `tpm issue view`）。読めないまま振られたら `課題の写し: 無し（<訳>）` と出る。

### Jira の課題の欄を書く

依頼書が課題の欄を変えることを求めたとき、`acli` に命令の無い欄（コンポーネントなど）は、claude.ai の Atlassian の connector（`mcp__claude_ai_Atlassian_Rovo__editJiraIssue`）で書く。Product Manager の画面の手に回す前に、まず connector で書けるかを当たる。

| connector で書いてよい | connector で書かない（`tpm` の命令で書く） |
|---|---|
| 依頼書が変えることを求めた課題の欄: コンポーネント・ラベル・題・本文など | コメント（記録は `tpm report …`・`tpm ask pm` が書く） |
| | 状態を進める（課題を済みにするのは `tpm report end` だけ） |

- guard は Bash の命令だけを見るので、connector のコメントや状態を進める道具は止めない。止められなくても使わない（使うと記録と状態が抜ける）。
- 書いたら、1 件ずつ `tpm issue view <Key>` か connector で読み戻して確かめる。
- connector がつながっていなければ（道具が `/mcp` で認証するようにと返したら）、`tpm ask tpm` で Product Manager に認証を頼む。認証は 1 度すれば、ほかの担当の session でも使える。
- スペースを作る・課題を別のスペースへ移す・コンポーネントを作るなど、`acli` にも connector にも道具の無い操作は、Product Manager の画面の手になる。手順のページでは、移すと変わる Key でなく、題か古い Key の検索で課題を指す。

## ページ

依頼書・確認・提案・計画・結果・監査は、HTML の file に書いて、tpm を動かす機械の置き場（`127.0.0.1` の pagetray。ページを DB に持つサーバーで、起こすのは DevOps Engineer 担当）に置く。置いた物を「ページ」と言う。Artifact tool（publish・read・open）は、依頼書と成果には使わない。

- 置く: `tpm page put <file> --kind <brief|confirm|proposal|plan|result|review|audit|issue>`（`review` は Staff Engineer 担当のレビューのページ）。担当の Key は今の課題の Key。TPM 担当は `--key <Key>` を付ける。出た `URL:` を、`tpm assign --brief`・`tpm ask pm --url`・`tpm report done --url` に書く。番号は置き場が決める。同じ種類を置き直すと次の番号になり、前の版は残る。置いた担当の役割と居場所の宛先も、置き場が覚える。
- 読む: `tpm page path <URL>` で file の path にして Read tool で読む（tpm を動かす機械の控えの path。控えに無ければ置き場から取る。前の置き場の `8800` の URL も読める）。
- 時系列のページ（種類は `timeline`）は、`tpm incident timeline` が state の記録から作って置く（下の「思わぬ出来事」）。手では置かない。
- 探す: `tpm page list`（今の project の新しい順）。`--key <Key>`・`--role <役割>`・`--workspace <宛先>`・`--kind <種類>`・`--q <語>`・`--reply <waiting|answered>`（返事の状態）で絞り、`--json` で記録を出す。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）で同じように絞って見る。
- 開く: ページは自動では開かない（`tpm ask pm`・`tpm report done` も開かない）。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）を 1 つ開いておき、新着の印で気づいて読む。その場で開いて人に見せる時だけ `tpm show <URL>`。
- 返事の状態: Product Manager の返事が要るページ（確認のページ）には、置き場が「返事待ち」「答えた」の状態を持つ（pagetray 0.5.0 から）。**担当は手で書かない。**`tpm ask pm` が、送った確認のページを返事待ちにし、TPM 担当の `tpm answer` が答えたにする。Product Manager は、置き場の一覧の UI の「返事待ち N 件」と行の印で、返事が要るページを見分ける。
  - 置いただけの確認のページには印が付かない。`tpm ask pm` で送って初めて返事待ちになる。
  - 前の確認を置き換える確認（計画を直して「進むか」を聞き直すなど）は、`tpm ask pm --supersede <古い確認の URL>` で送る。送った後、古い確認の返事待ちが外れる（同じ Key の返事待ちの確認だけを受け、別の Key・答え済み・送っていない確認は送る前に断る）。
  - `tpm answer` は、その Key の返事待ちのページが 1 枚なら、それを答えたにする。2 枚以上ある時は、送る前に止まって URL を並べるので、どのページへの答えかを `--url <確認の URL>`（何度でも）で書くか、みなへの答えなら `--all` を付けて打ち直す。
  - 置き場が応えない・版が古い（0.5.0 より前）時は、印は付かないが、メッセージは送られる（`置き場の印: 付けていない` と出る）。
  - 手で直すのは TPM 担当だけ: `tpm page reply <URL>… --waiting|--answered`。`tpm answer` を通らずに済んだ確認（取り下げた・次の依頼書で答えた）を答えたにする時と、置き場が応えない間に送った確認を返事待ちにする時に使う。`tpm dismiss` は、その Key に返事待ちのページが残っていれば URL を出す。担当は `tpm ask tpm` で頼む。
- 消す: **消してよいのは TPM 担当だけ**（戻せない。Auditor が置いたページは、Product Manager の言葉を添えなければ TPM 担当も消せない。上の「監査」）。試しに置いた・置き間違えたページは、担当は自分で消さず、`tpm ask tpm` で URL と訳を送って頼む（担当の居場所からの `tpm page delete` と、置き場に消す要求を直に送る `curl`、置き場の CLI の `pagetray page delete` は止まる）。TPM 担当は `tpm page delete <URL>…`（Key ごとなら `--key <Key>`、project ごとなら `--project <名>`。その Key・project の file も一緒に消える）で消す物を見て、`--yes` を付けて消す。控えの file も消える。消したページの URL は 410 を返し、その番号は 2 度使われない。
- 送り手: project に castlist の設定があれば、`tpm page put`・`tpm file put` は、自分の session を指す付随する id を付けて置く（置き場が castlist に聞き、ページと file の記録に送り手として残す。担当は何も足さない）。置き場が断ると、ページも file も置かれていない（`tpm` は送り直さない）。
  - 「castlist に送り手を聞けませんでした（503）」: 置き場が castlist に届かない。castlist が起きてから打ち直す（止まっていれば、下の「アクターの台帳」のとおり guard も止まる）。castlist が起きているのに続く時は、`tpm report incident` で台帳に挙げる。
  - 「castlist に登録が無いと、置き場が答えました（422）」: この session が castlist にまだ無い。session は guard が Bash の前に登録するので、打ち直す。続く時は `tpm report incident` で台帳に挙げる。
- 置き場が応えなければ、ページは置けない（`tpm page put` が止まる。番号を置き場が決めるため）。控えにあるページは読める。`tpm ask devops --what "置き場（pagetray）を起こす" --why "<何が置けないか>"` で頼む。自分では container を起こさない。
- 図: Product Manager が読むページには、下の図を入れる。描く図はページの中に inline の SVG で描く（file に上げない。字で描くので、画面の写しのような写り込みが無い）。file で上げるのは画面の写しだけ。ひな形と描き方は、この folder の `figures.md`。

  | ページ | 入れる図 |
  |---|---|
  | 確認 | 項目ごとに、選ぶ問いの木を 1 つ（Product Manager が答えれば選択肢が決まる問いを 1〜2 つ並べ、書き手の見立ての道を色で示す）。性質の比べは表に任せる。Product Manager が答えて選びが決まる問いが無い項目（2 択で違いが 1 つ・違いが技術の差だけ、など）は図を入れず、訳を 1 行 |
  | 提案 | 案を選ぶ問いの木（確認と同じ形）。案がどこに効くか・何を変えるかの流れの図 |
  | 計画 | 今と後（前と後）か、段の流れ |
  | 結果 | 変えた所の前と後。画面を変えたなら、画面の写しを `tpm file put` で上げる |
  | 監査 | 指摘の数の推移と、勧告ごとの並べ（`figures.md` の「5. 並べ」） |
  | 依頼書 | 要る所だけ（読むのは担当） |

  - 図を入れないページには、入れない訳を頭に 1 行書く（例: 「図: 無し。変えたのは文 1 行だけ」）。
  - 図の中の字は SVG の text で書き（画像の中の字にしない）、`role="img"` と `aria-label` を付ける。色は明るい画面と暗い画面の両方で読めるように、ひな形の色の変数を使う。
- file（画像・PDF・字の file）: ページに付ける画面の写し・図・log は、置き場に上げて、ページから相対で参照する。受けるのは png・jpg・jpeg・gif・webp・pdf・txt・log・md・csv・json で、1 つ 16 MiB まで（動画・HTML・SVG は受けない）。
  - 上げる: `tpm file put <file> --reviewed`（TPM 担当は `--key <Key>` も）。画像と PDF は、上げる前に Read tool で見て、token・鍵・個人の情報・ほかの人の画面・tpm を動かす機械の path が写っていないか確かめる（`--reviewed` が無いと止まる）。字の file は秘密の形を走査し、当たれば行の番号を出して止まる。置き場での名は元の名から作り（`--name <語>.<拡張子>` で替えられる）、番号は置き場が付ける。同じ名で上げ直すと次の番号になり、前の物は残る。
  - ページには、出た `ページからの参照:` の形で相対に書く（同じ Key なら `<img src="files/<語>-<n>.<拡張子>">`、別の Key なら `../<Key>/files/…`）。置き場でも控えでも同じ形で開く。
  - 読む: `tpm file path <URL>` で file の path にして Read tool で読む。`tpm page path` も、ページが参照する file を控えに写し、`参照の file:` の行に path を出す。探すのは `tpm file list`。
  - 消す: ページと同じく TPM 担当だけ。担当は `tpm ask tpm` で URL と訳を送って頼む（秘密を上げてしまった時は、すぐ）。TPM 担当は `tpm file delete <URL>…` で消す物と、それを参照しているページを見て、`--yes` を付けて消す。
  - 「置き場（pagetray）の版が古く、file を扱えません」と出たら、`tpm ask devops` で置き場の版を上げるよう頼む。

## Product Manager に確かめる

文書やコメントの食い違い**以外**で Product Manager に決めてほしいことは、確認のページに書いて【ask-pm】で送る。課題管理の課題があってもなくても同じ。

1. 確認のページを HTML の file に書く。項目ごとに、背景・選択肢・お勧めとその訳を書き、選択肢を表に、選ぶ時の問い（Product Manager が答えれば決まる物）を図にする（図は上の「ページ」の図の項）。
2. `tpm page put <file> --kind confirm` で置く（上の「ページ」）。
3. 出た URL で `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` を打つ。TPM 担当に【ask-pm】が行き、状態が `回答待ち(PM): <何を>` になり、置き場の確認のページが返事待ちになる（上の「ページ」の返事の状態）。**前の確認（まだ返事待ちの物）を置き換えるなら、必ず `--supersede <古い確認の URL>` で名指す**（何度でも）。名指した確認の返事待ちが外れる。名指さないと、答える要の無い確認が Product Manager の画面の「返事待ち」に残り続ける（2026-11-22 の t-23zs の confirm-14）。
4. 答えは【answer】で来る。

## 文書の食い違い

文書やコメントの食い違いを見つけた時にすることは、担当で違う。

| 担当 | すること |
|---|---|
| TPM 担当 | 自分で直さず、課題として Software Engineer 担当に回す（`/tpm` の 2） |
| Staff Engineer 担当 | **直さない。**レビューのページの指摘に挙げる。直すのは、課題の担当 |
| Software Engineer 担当・DevOps Engineer 担当・Sustaining Engineer 担当 | お勧めの直し方で直し、PR を merge まで自分で進める（Product Manager の確認は要らない）。worktree で作業し、PR の題か本文に課題の Key を入れる。merge したら【doc-fix】で知らせ、成果のページにも一覧で載せる |
| Auditor | **直さない。**監査のページの「見つけた食い違い」に、file・今の文・コードの実際・お勧めの直し方を挙げる。Product Manager が通せば、TPM 担当が課題にして振る |

文書とコードが食い違うときは、コードの方に合わせる。

## 共有の環境

環境（container・サーバーなど）を変えてよいかは、project の設定に書いた手続きで決まる。`tpm infra list` が環境と手続きを出す（直下の folder の設定の宣言も合わせた物。どの folder で打った命令にも効く）。

| 手続き | 困る人 | 変えてよい担当 | 先に要ること |
|---|---|---|---|
| 自由 | 自分だけ | どの担当も | 無し |
| TPM に相談 | 並べて動いているほかの担当 | DevOps Engineer 担当だけ | 【ask-tpm】で何が止まるかとお勧めを送り、答えを待つ |
| PM の承認 | ほかの人・ほかのチーム | DevOps Engineer 担当だけ | 【ask-pm】で承認を取る。承認は時間を限って効く |
| PM だけ | Product Manager が自分の手に取っておく物 | どの担当も打てない（TPM 担当・DevOps Engineer 担当も。承認も書けない） | 打ってほしい 1 行と訳を確認のページに書き、【ask-pm】で送る。Product Manager が自分の terminal で直に打つ |

- 自分が変えてよくない環境は、自分では変えず【ask-devops】で TPM 担当に送る。
- 手続きを踏んでいない命令は、guard が実行の前に止める。止まったら、出た文のとおりに頼む（別の書き方で通そうとしない）。
- 設定に書かれていない環境で、並べて動いている担当やほかの人が困りそうな物を変えるときも、先に【ask-tpm】を送る。
- 手元で image を build する builder（環境 `builder`。container の名は `buildkit`）は、どの担当も使う。`container build` はそのまま打つ（builder が止まっていれば build が起こす）。build に `-c`・`-m`・`--ssh`・`--dns…` を付けない（動いている builder を作り直し、ほかの担当の build が落ちる。guard はこれを止められない）。要るなら【ask-devops】。

## アクターの台帳（castlist）

project の設定に castlist（アクターの台帳）の URL があれば、`tpm` が、自分の session の始まり・終わり・名乗り・model と effort を castlist に送る（hook と命令が送るので、担当は何も打たない）。

- `tpm hello` の出力の頭に `アクター: <名>`（`t-23zs-swe.1` など）が出る。結果のページや報告で自分を名指す時は、この名を使ってよい。
- castlist が止まっていると、`tpm hello` は名乗らずに止まり、guard は Bash を止める。どちらも、Product Manager が自分の terminal で打つ 1 行（`container start castlist.box` か `container run …`。0.1.0 の名 `castlist` で動いている間は、その名の `container start`）を出す。その 1 行は自分で打たない（castlist を起こすのは Product Manager だけ。guard も止める）。Bash が止まると `tpm` の命令も打てないので、TPM 担当はその 1 行を返答に書いて Product Manager に頼み（打てれば `tpm wait pm "castlist を起こす" --hand`）、担当はその 1 行を返答に書いて止まる（TPM 担当の Bash も同じく止まるので、Product Manager が起こした後に、TPM 担当が `tpm notify` で打ち直すよう伝える）。起きたら、止まった命令を打ち直す。
- castlist の時計がずれていると 1 行出る（止まらない）。出たら `tpm report incident` で台帳に挙げる。

## 終わり方

- Software Engineer 担当と DevOps Engineer 担当は、依頼書 1 つが済むごとに【done】を送り、次の【brief】を待つ。同じ課題の続きは同じ担当が受ける。【dismiss】が来るまで自分から終えない（`tpm report end` は【dismiss】の前には送れない）。
- 自分の居場所（workspace）は自分で閉じない。【end】を送った後、TPM 担当が報告を受けてから閉じる。
- 自分で作った worktree と branch は、merge の後に消す（`git worktree list` に本体だけが残ること）。
- Staff Engineer 担当は、レビューを【review】で課題の担当へ返し、次の頼み（【ask-review】）を待つ。【done】も【end】も送らない。席は、TPM 担当が課題の担当の席と一緒に閉じる（上の「レビュー」）。
- Auditor の席は、Product Manager が起こし、閉じる。【done】も【end】も送らず、報告と決定の後は次の `/audit` を待つ。
