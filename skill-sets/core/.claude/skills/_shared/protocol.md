# 担当のあいだの決まり（どの担当も読む）

TPM 担当（`/tpm`）・Software Engineer 担当（`/software-engineer`）・DevOps Engineer 担当（`/devops-engineer`）・Sustaining Engineer 担当（`/sustaining-engineer`）・Auditor（`/audit`）が共通に従う決まり。依頼主は Product Manager（利用者）。返答と報告は日本語で書く。

担当どうしのやりとりは、すべて `tpm` の命令でする。`tpm` が、メッセージを送る・届いたかを見る・課題に記録を書く・状態を出す、を 1 度にする。連携の道具（cmux など）の命令と、課題管理の道具（Jira・GitHub の Issue）で記録を書く・状態を進める命令は直に打たない（直に打つと記録と状態が抜けるので、guard が止める）。課題管理の課題を読む命令は止めないが、読むときも `tpm issue view` を使う（下の「課題を読む」）。どの道具を使うかは、TPM 担当を起こした folder と、その直下の folder の `.claude/roles/config.jsonc` を合わせた設定で決まる（下の repo をいくつも触る課題のため。課題の記録の先は、課題の Key の形で決まる）。

## 連絡の仕方

- メッセージは、下の「見出し」の表の命令で送る。命令は「届いた」か「まだ届いていない」を返す。相手が手を動かしている間は届かず、空いたら届くので、送り直さない。
- メッセージは、手が空いた時に画面に届く。段の区切り（PR を出す前・merge を頼む前）と、戻せない手（tag を打つ・release を出す・消す）の前には `tpm inbox` で、まだ届いていない自分宛てのメッセージを見る。
- メッセージを送る命令は、送る前に受信箱を見る。送る相手から来て、まだ読んでいないメッセージがあれば、それを出して 1 度止まる（送っていない。課題の記録も書いていない）。読んで、同じ命令を打ち直す。届いたメッセージで事情が変わっていたら、中身を変えて打つ。`tpm page put` も、確認・提案・計画・結果のページ（`--kind confirm|proposal|plan|result`）は、置く前に同じように見て 1 度止まる（置いていない）。事情が変わっていたら、ページを書き直して置く。
- **打ち直しは、止まったのを見てから別の回に打つ。**`;` や `||` で 1 行に続けて書かない（止まらなかった時にも 2 度目が動く）。同じメッセージを 30 秒の内に 2 度送ろうとすると、命令は 2 度目を送らずに止まる。
- 届いたメッセージには id が付いている。そのメッセージへの返事は `--reply-to <id>` を付けて送る。
- 宛先は書かない。担当のメッセージは TPM 担当へ行き、TPM 担当は課題の Key で担当を名指す。
- **Product Manager に直接聞かない。** Product Manager とのやりとりは、すべて TPM 担当を通す。例外は Auditor だけ: Product Manager が起こした `Audit` の席で、Product Manager とじかに話す（下の「監査」）。
- 命令の使い方は `tpm <命令> --help`。命令が誤りで止まったら、出た文に従って直す（道具の命令に替えて先へ進まない）。

## 見出し

### TPM 担当へ

| 見出し | いつ | 命令 |
|---|---|---|
| 【ask-tpm】 | TPM 担当に決めてほしいことがある | `tpm ask tpm "<困っていること・試したこと・案とお勧め>" --waiting-for "<何を>"` |
| 【ask-pm】 | Product Manager に決めてほしいこと・頼むことを確認のページに書いて置いた（下の「Product Manager に確かめる」） | `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` |
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

Auditor（監査の担当。Product Manager が起こす `Audit` の席）だけが使う見出しは 2 つ。【audit】は、Product Manager へじかに出した監査の報告の写し（`tpm report audit`）。【decided】は、Product Manager の決定（`tpm report decided`）。Auditor は、【done】【end】【merged】【doc-fix】【ask-pm】を送らない（下の「監査」）。

### TPM 担当から

| 見出し | 中身 | 命令（TPM 担当が打つ） |
|---|---|---|
| 【brief】 | 新しい依頼書の URL。下の「ページ」のとおり読み、それに従う。「取り消す: brief-N」とあれば brief-N の作業をやめてこちらに従い、「brief-N を済ませてから、これをする」とあれば brief-N の【done】の後に始める | `tpm assign <Key> --role <役割> --brief <URL> [--supersede\|--after]` |
| 【answer】 | Product Manager の答え。待ちの表示を作業中に戻して続ける | `tpm answer <Key> "<答え>"` |
| 【notify】 | 知っておくこと・受け取ったという返事。返事は要らない | `tpm notify <Key> "<本文>"` |
| 【dismiss】 | この課題に続きは無い（Product Manager が決めたか、TPM 担当が聞かなくてよいと決めた）。worktree を片付けて【end】を返す。担当の交代のためなら、そう書いてある。「取り消す: brief-N」とあれば brief-N の作業もやめる | `tpm dismiss <Key> [--handover] [--supersede]` |

## 状態

- 出すのは **`model` と `wait` の 2 つだけ**。`model` は名乗ったとき（`tpm hello`）に出る。
- `wait`: 「今、誰が何を待っているか」を 1 つだけ。状況が変わるたびに上書きする。
  - 自分が動いている: `tpm wait work "<段>"`（`作業中: <段>`）
  - Product Manager の答えを待つ: `tpm wait pm "<何を>"`（`回答待ち(PM): <何を>`）。TPM 担当が Product Manager に手の操作を頼んで待つ回は `--hand` を付ける（下の「思わぬ出来事」）
  - TPM 担当の答えを待つ: `tpm wait tpm "<何を>"`（`回答待ち(TPM): <何を>`）
  - 待つ時間に限りがあれば添える: `tpm wait tpm "merge（14:30 まで）"`
- `tpm wait` は打った時刻も覚える。Product Manager の Mac のバナーは、TPM 担当が**その回に** `tpm wait pm` を打って手を止めた時に出る（設定は docs の「設定」の「Mac のバナー」）。
- やりとりの命令は、メッセージを送った後の待ちも出す（`tpm ask …` は回答待ち、`tpm report done` は `回答待ち(TPM): 次の依頼`、`tpm report end` は `回答待ち(TPM): workspace を閉じる`）。答えが来たら `tpm wait work "<段>"` に戻す。
- **`/model`・`/effort` は打たない**（新しい session の既定まで書き換わる）。model と effort は起動の旗で決まる。

## 記録

課題管理の課題（`tpm hello` が返す「課題管理の課題」）があれば、やりとりの命令のうち下の表の物が、課題にコメントを 1 件書く。課題が無い・課題管理を使わない project では何も書かない。担当が自分で課題にコメントを書いたり、状態を進めたりはしない。

| 命令 | 書く記録（1 行目は `【<種類>】<担当>: <一言>`） |
|---|---|
| `tpm report done --kind <種類>` | `提案`・`計画`・`結果`・`監査`（`--kind` の `proposal`・`plan`・`result`・`audit`）。成果の URL と、`--point` の要点（3 つまで） |
| `tpm report doc-fix` | `文書の修正`。PR の URL |
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
- **台帳・送ったメッセージの記録（state の `*.jsonl`）は、メッセージや命令の字を持つ。この Mac の外（課題管理のコメント・PR の本文・公開の site）に写さない。**【incident】は課題管理に記録を書かない。

## 監査

担当の仕組みが、信頼でき、安全で、むだなく回っているかは、Auditor が調べる。Auditor は TPM 担当の回し方も見るので、監査は TPM 担当の手を通らない。何のために・どこまで・誰に、は監査の規程（この folder の `audit-charter.md`。Product Manager が承認した物）にあり、どの担当もそれに従う。

- **始めるのは、いつも Product Manager。** Product Manager が `tpm audit start` で `Audit` の席を起こし、その席で `/audit`（定期の監査。目安は週 1）か `/audit <件の番号…>`（臨時の監査）を呼ぶ。自動では始まらない。
- **報告は Product Manager へじかに。** Auditor は監査のページを置き、`Audit` の席で Product Manager に報告する。TPM 担当には写し（【audit】）が行く。Product Manager はその席で答え、Auditor が決定を TPM 担当に渡す（【decided】）。
- **TPM 担当**は、【audit】を伝え直さない。【decided】の「する」の勧告を、いつもの課題として担当に振り、`tpm incident assign <番号>… --to <振り先の Key>` で件に結ぶ。Auditor からの【ask-tpm】（事実の確かめ）には、知っていることを答える。
- **TPM 担当とほかの担当は、監査を止めない・範囲を狭めない。** `Audit` の席を起こさない・閉じない（`tpm audit start` を打つのは Product Manager。`tpm assign`・`tpm dismiss`・`tpm close` は、この席を断る）。Auditor の置いたページを消さない（消す訳があれば、Product Manager の言葉を `tpm page delete … --pm "<言葉>"` に添える。記録に残る）。
- **Auditor は直さない・決めない。** repo・設定・環境を変えず、PR を出さず、課題を振らず、課題管理に書かない（書き込みと `git`・`gh` の変える命令は guard が止める）。どの改善をするか・受け入れるかは Product Manager が決める。
- Auditor の席に、依頼書・【dismiss】・【end】は無い。席は Product Manager が閉じる。

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

依頼書・確認・提案・計画・結果・監査は、HTML の file に書いて、この Mac の置き場（`127.0.0.1` の pagetray。ページを DB に持つサーバーで、起こすのは DevOps Engineer 担当）に置く。置いた物を「ページ」と言う。Artifact tool（publish・read・open）は、依頼書と成果には使わない。

- 置く: `tpm page put <file> --kind <brief|confirm|proposal|plan|result|audit|issue>`。担当の Key は今の課題の Key。TPM 担当は `--key <Key>` を付ける。出た `URL:` を、`tpm assign --brief`・`tpm ask pm --url`・`tpm report done --url` に書く。番号は置き場が決める。同じ種類を置き直すと次の番号になり、前の版は残る。置いた担当の役割と居場所の宛先も、置き場が覚える。
- 読む: `tpm page path <URL>` で file の path にして Read tool で読む（この Mac の控えの path。控えに無ければ置き場から取る。前の置き場の `8800` の URL も読める）。
- 時系列のページ（種類は `timeline`）は、`tpm incident timeline` が state の記録から作って置く（下の「思わぬ出来事」）。手では置かない。
- 探す: `tpm page list`（今の project の新しい順）。`--key <Key>`・`--role <役割>`・`--workspace <宛先>`・`--kind <種類>`・`--q <語>` で絞り、`--json` で記録を出す。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）で同じように絞って見る。
- 開く: ページは自動では開かない（`tpm ask pm`・`tpm report done` も開かない）。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）を 1 つ開いておき、新着の印で気づいて読む。その場で開いて人に見せる時だけ `tpm show <URL>`。
- 消す: **消してよいのは TPM 担当だけ**（戻せない。Auditor が置いたページは、Product Manager の言葉を添えなければ TPM 担当も消せない。上の「監査」）。試しに置いた・置き間違えたページは、担当は自分で消さず、`tpm ask tpm` で URL と訳を送って頼む（担当の居場所からの `tpm page delete` と、置き場に消す要求を直に送る `curl`、置き場の CLI の `pagetray page delete` は止まる）。TPM 担当は `tpm page delete <URL>…`（Key ごとなら `--key <Key>`、project ごとなら `--project <名>`。その Key・project の file も一緒に消える）で消す物を見て、`--yes` を付けて消す。控えの file も消える。消したページの URL は 410 を返し、その番号は 2 度使われない。
- 置き場が応えなければ、ページは置けない（`tpm page put` が止まる。番号を置き場が決めるため）。控えにあるページは読める。`tpm ask devops --what "置き場（pagetray）を起こす" --why "<何が置けないか>"` で頼む。自分では container を起こさない。
- 図があった方がわかりやすい所は図を入れる。
- file（画像・PDF・字の file）: ページに付ける画面の写し・図・log は、置き場に上げて、ページから相対で参照する。受けるのは png・jpg・jpeg・gif・webp・pdf・txt・log・md・csv・json で、1 つ 16 MiB まで（動画・HTML・SVG は受けない）。
  - 上げる: `tpm file put <file> --reviewed`（TPM 担当は `--key <Key>` も）。画像と PDF は、上げる前に Read tool で見て、token・鍵・個人の情報・ほかの人の画面・この Mac の path が写っていないか確かめる（`--reviewed` が無いと止まる）。字の file は秘密の形を走査し、当たれば行の番号を出して止まる。置き場での名は元の名から作り（`--name <語>.<拡張子>` で替えられる）、番号は置き場が付ける。同じ名で上げ直すと次の番号になり、前の物は残る。
  - ページには、出た `ページからの参照:` の形で相対に書く（同じ Key なら `<img src="files/<語>-<n>.<拡張子>">`、別の Key なら `../<Key>/files/…`）。置き場でも控えでも同じ形で開く。
  - 読む: `tpm file path <URL>` で file の path にして Read tool で読む。`tpm page path` も、ページが参照する file を控えに写し、`参照の file:` の行に path を出す。探すのは `tpm file list`。
  - 消す: ページと同じく TPM 担当だけ。担当は `tpm ask tpm` で URL と訳を送って頼む（秘密を上げてしまった時は、すぐ）。TPM 担当は `tpm file delete <URL>…` で消す物と、それを参照しているページを見て、`--yes` を付けて消す。
  - 「置き場（pagetray）の版が古く、file を扱えません」と出たら、`tpm ask devops` で置き場の版を上げるよう頼む。

## Product Manager に確かめる

文書やコメントの食い違い**以外**で Product Manager に決めてほしいことは、確認のページに書いて【ask-pm】で送る。課題管理の課題があってもなくても同じ。

1. 確認のページを HTML の file に書く。項目ごとに、背景・選択肢・お勧めとその訳を書き、比べる物は表か図にする。
2. `tpm page put <file> --kind confirm` で置く（上の「ページ」）。
3. 出た URL で `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` を打つ。TPM 担当に【ask-pm】が行き、状態が `回答待ち(PM): <何を>` になる。
4. 答えは【answer】で来る。

## 文書の食い違い

文書やコメントの食い違いを見つけた時にすることは、担当で違う。

| 担当 | すること |
|---|---|
| TPM 担当 | 自分で直さず、課題として Software Engineer 担当に回す（`/tpm` の 2） |
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

- 自分が変えてよくない環境は、自分では変えず【ask-devops】で TPM 担当に送る。
- 手続きを踏んでいない命令は、guard が実行の前に止める。止まったら、出た文のとおりに頼む（別の書き方で通そうとしない）。
- 設定に書かれていない環境で、並べて動いている担当やほかの人が困りそうな物を変えるときも、先に【ask-tpm】を送る。

## 終わり方

- Software Engineer 担当と DevOps Engineer 担当は、依頼書 1 つが済むごとに【done】を送り、次の【brief】を待つ。同じ課題の続きは同じ担当が受ける。【dismiss】が来るまで自分から終えない（`tpm report end` は【dismiss】の前には送れない）。
- 自分の居場所（workspace）は自分で閉じない。【end】を送った後、TPM 担当が報告を受けてから閉じる。
- 自分で作った worktree と branch は、merge の後に消す（`git worktree list` に本体だけが残ること）。
- Auditor の席は、Product Manager が起こし、閉じる。【done】も【end】も送らず、報告と決定の後は次の `/audit` を待つ。
