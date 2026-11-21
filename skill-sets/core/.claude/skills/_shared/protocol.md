# 担当のあいだの決まり（どの担当も読む）

TPM 担当（`/tpm`）・Software Engineer 担当（`/software-engineer`）・DevOps Engineer 担当（`/devops-engineer`）・Sustaining Engineer 担当（`/sustaining-engineer`）が共通に従う決まり。依頼主は Product Manager（利用者）。返答と報告は日本語で書く。

担当どうしのやりとりは、すべて `tpm` の命令でする。`tpm` が、メッセージを送る・届いたかを見る・課題に記録を書く・状態を出す、を 1 度にする。連携の道具（cmux など）の命令と、課題管理の道具（Jira・GitHub の Issue）で記録を書く・状態を進める命令は直に打たない（直に打つと記録と状態が抜けるので、guard が止める）。課題管理の課題を読む命令は止めないが、読むときも `tpm issue view` を使う（下の「課題を読む」）。どの道具を使うかは、TPM 担当を起こした folder と、その直下の folder の `.claude/roles/config.jsonc` を合わせた設定で決まる（下の repo をいくつも触る課題のため。課題の記録の先は、課題の Key の形で決まる）。

## 連絡の仕方

- メッセージは、下の「見出し」の表の命令で送る。命令は「届いた」か「まだ届いていない」を返す。相手が手を動かしている間は届かず、空いたら届くので、送り直さない。
- メッセージは、手が空いた時に画面に届く。段の区切り（PR を出す前・merge を頼む前）には `tpm inbox` で、まだ届いていない自分宛てのメッセージを見る。
- 届いたメッセージには id が付いている。そのメッセージへの返事は `--reply-to <id>` を付けて送る。
- 宛先は書かない。担当のメッセージは TPM 担当へ行き、TPM 担当は課題の Key で担当を名指す。
- **Product Manager に直接聞かない。** Product Manager とのやりとりは、すべて TPM 担当を通す。
- 命令の使い方は `tpm <命令> --help`。命令が誤りで止まったら、出た文に従って直す（道具の命令に替えて先へ進まない）。

## 見出し

### TPM 担当へ

| 見出し | いつ | 命令 |
|---|---|---|
| 【ask-tpm】 | TPM 担当に決めてほしいことがある | `tpm ask tpm "<困っていること・試したこと・案とお勧め>" --waiting-for "<何を>"` |
| 【ask-pm】 | Product Manager に決めてほしいこと・頼むことを確認のページに書いて置いた（下の「Product Manager に確かめる」） | `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` |
| 【ask-devops】 | 共有の環境で DevOps Engineer 担当の手が要る（下の「共有の環境」） | `tpm ask devops --what "<何を>" --why "<なぜ>" [--urgent]` |
| 【doc-fix】 | 文書やコメントの食い違いを直した PR を merge した | `tpm report doc-fix --pr <URL> --note "<一言>"` |
| 【merged】 | 自分の PR を 1 本 merge した | `tpm report merged --pr <URL> --note "<一言>"` |
| 【done】 | 依頼書の成果（提案・計画・結果のページ）を置いた | `tpm report done --url <URL> --kind <proposal\|plan\|result> --summary "<要点>" --remaining "<残り>" --decisions "<決めてほしいこと>"` |
| 【end】 | 【dismiss】を受けて片付けた（Sustaining Engineer 担当は PR を merge した後） | `tpm report end --url <URL> --pr <URL> … --removed <worktree> … --left "<残っている物>"` |

- 【done】の「残り」は、依頼の外で直すとよい物・やらなかった物・merge していない PR。「決めてほしいこと」は、【ask-pm】で送った項目の題。どちらも無ければ「なし」と書く（書かないと送れない）。TPM 担当はこの 2 つで【dismiss】を送るかを決める。
- 【end】の「残っている物」は、計画から外れた物・残した物で直した方がよい物。無ければ「なし」。

Dependabot の PR だけで使う見出し（【merge-request】【not-yet】【recreated】）は `/sustaining-engineer` と `/dependabot-triage` に書いてある。

### TPM 担当から

| 見出し | 中身 | 命令（TPM 担当が打つ） |
|---|---|---|
| 【brief】 | 新しい依頼書の URL。下の「ページ」のとおり読み、それに従う | `tpm assign <Key> --role <役割> --brief <URL>` |
| 【answer】 | Product Manager の答え。待ちの表示を作業中に戻して続ける | `tpm answer <Key> "<答え>"` |
| 【notify】 | 知っておくこと・受け取ったという返事。返事は要らない | `tpm notify <Key> "<本文>"` |
| 【dismiss】 | この課題に続きは無い（Product Manager が決めたか、TPM 担当が聞かなくてよいと決めた）。worktree を片付けて【end】を返す。担当の交代のためなら、そう書いてある | `tpm dismiss <Key> [--handover]` |

## 状態

- 出すのは **`model` と `wait` の 2 つだけ**。`model` は名乗ったとき（`tpm hello`）に出る。
- `wait`: 「今、誰が何を待っているか」を 1 つだけ。状況が変わるたびに上書きする。
  - 自分が動いている: `tpm wait work "<段>"`（`作業中: <段>`）
  - Product Manager の答えを待つ: `tpm wait pm "<何を>"`（`回答待ち(PM): <何を>`）
  - TPM 担当の答えを待つ: `tpm wait tpm "<何を>"`（`回答待ち(TPM): <何を>`）
  - 待つ時間に限りがあれば添える: `tpm wait tpm "merge（14:30 まで）"`
- `tpm wait` は打った時刻も覚える。Product Manager の Mac のバナーは、TPM 担当が**その回に** `tpm wait pm` を打って手を止めた時に出る（設定は docs の「設定」の「Mac のバナー」）。
- やりとりの命令は、メッセージを送った後の待ちも出す（`tpm ask …` は回答待ち、`tpm report done` は `回答待ち(TPM): 次の依頼`、`tpm report end` は `回答待ち(TPM): workspace を閉じる`）。答えが来たら `tpm wait work "<段>"` に戻す。
- **`/model`・`/effort` は打たない**（新しい session の既定まで書き換わる）。model と effort は起動の旗で決まる。

## 記録

課題管理の課題（`tpm hello` が返す「課題管理の課題」）があれば、やりとりの命令のうち下の表の物が、課題にコメントを 1 件書く。課題が無い・課題管理を使わない project では何も書かない。担当が自分で課題にコメントを書いたり、状態を進めたりはしない。

| 命令 | 書く記録（1 行目は `【<種類>】<担当>: <一言>`） |
|---|---|
| `tpm report done --kind <種類>` | `提案`・`計画`・`結果`（`--kind` の `proposal`・`plan`・`result`）。成果の URL と、`--point` の要点（3 つまで） |
| `tpm report doc-fix` | `文書の修正`。PR の URL |
| `tpm ask pm` | `確認`。確認のページの URL と、項目の題 |
| `tpm answer`（TPM 担当） | `決定`。【answer】を返す前に書かれる |
| `tpm report end` | `結果`。続けて課題を済みにする（担当の交代の【dismiss】のときは済みにしない） |

- 中身はページに書き、記録には写さない。
- GitHub の Issue を使う project では、PR の題か本文に課題の Key を書くとき `Refs #12` と書く。`Closes #12` と書くと merge で勝手に閉じ、【dismiss】で閉じる決まりとずれる。

## 課題を読む

課題の Key が Jira（`AI-12`）か GitHub の Issue（`gh-12`）の形なら、課題の題・状態・本文・コメントを `tpm issue view <Key>` で読む。

- その Key の道具を宣言した設定が無い project でも読める（設定の `tracker` は `tpm` の命令が課題に記録を書くかを決めるだけで、課題は Key の形で道具を選んで読む）。
- `tpm hello` が `課題の中身:` の行を返したら、依頼書と一緒に読む。依頼書に Jira や GitHub の URL しか無くても、まずこれで読む。
- 読めなければ、出た誤りのとおりに Key と道具の認証を確かめる。認証が無ければ `tpm ask tpm` で、Product Manager に login を頼むことを送る。
- `t-` の Key には課題管理の課題が無い。中身は依頼書にある。
- 課題の写し: Key が読める形なら、`tpm assign` が振るたびに課題を読み、写しのページ（`issue-<番号>.html`）を置く。`tpm hello` と【brief】が `課題の写し: <URL>` を返したら、依頼書と一緒に読む（振ったときの中身。新しい中身は `tpm issue view`）。読めないまま振られたら `課題の写し: 無し（<訳>）` と出る。

## ページ

依頼書・確認・提案・計画・結果は、HTML の file に書いて、この Mac の置き場（`127.0.0.1` の pagetray。ページを DB に持つサーバーで、起こすのは DevOps Engineer 担当）に置く。置いた物を「ページ」と言う。Artifact tool（publish・read・open）は、依頼書と成果には使わない。

- 置く: `tpm page put <file> --kind <brief|confirm|proposal|plan|result|issue>`。担当の Key は今の課題の Key。TPM 担当は `--key <Key>` を付ける。出た `URL:` を、`tpm assign --brief`・`tpm ask pm --url`・`tpm report done --url` に書く。番号は置き場が決める。同じ種類を置き直すと次の番号になり、前の版は残る。置いた担当の役割と居場所の宛先も、置き場が覚える。
- 読む: `tpm page path <URL>` で file の path にして Read tool で読む（この Mac の控えの path。控えに無ければ置き場から取る。前の置き場の `8800` の URL も読める）。
- 探す: `tpm page list`（今の project の新しい順）。`--key <Key>`・`--role <役割>`・`--workspace <宛先>`・`--kind <種類>`・`--q <語>` で絞り、`--json` で記録を出す。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）で同じように絞って見る。
- 開く: ページは自動では開かない（`tpm ask pm`・`tpm report done` も開かない）。Product Manager は、置き場の一覧の UI（`http://127.0.0.1:8801/`）を 1 つ開いておき、新着の印で気づいて読む。その場で開いて人に見せる時だけ `tpm show <URL>`。
- 消す: **消してよいのは TPM 担当だけ**（戻せない）。試しに置いた・置き間違えたページは、担当は自分で消さず、`tpm ask tpm` で URL と訳を送って頼む（担当の居場所からの `tpm page delete` と、置き場に消す要求を直に送る `curl` は止まる）。TPM 担当は `tpm page delete <URL>…`（Key ごとなら `--key <Key>`、project ごとなら `--project <名>`）で消す物を見て、`--yes` を付けて消す。控えの file も消える。消したページの URL は 410 を返し、その番号は 2 度使われない。
- 置き場が応えなければ、ページは置けない（`tpm page put` が止まる。番号を置き場が決めるため）。控えにあるページは読める。`tpm ask devops --what "置き場（pagetray）を起こす" --why "<何が置けないか>"` で頼む。自分では container を起こさない。
- 図があった方がわかりやすい所は図を入れる。

## Product Manager に確かめる

文書やコメントの食い違い**以外**で Product Manager に決めてほしいことは、確認のページに書いて【ask-pm】で送る。課題管理の課題があってもなくても同じ。

1. 確認のページを HTML の file に書く。項目ごとに、背景・選択肢・お勧めとその訳を書き、比べる物は表か図にする。
2. `tpm page put <file> --kind confirm` で置く（上の「ページ」）。
3. 出た URL で `tpm ask pm --url <URL> --item "<項目の題>" … --waiting-for "<何を>"` を打つ。TPM 担当に【ask-pm】が行き、状態が `回答待ち(PM): <何を>` になる。
4. 答えは【answer】で来る。

## 文書の食い違い

TPM 担当は自分で直さず、課題として Software Engineer 担当に回す（`/tpm` の 2）。ほかの担当は、調べている途中で文書やコメントの食い違いを見つけたら、お勧めの直し方で直し、PR を merge まで自分で進める（Product Manager の確認は要らない）。worktree で作業し、PR の題か本文に課題の Key を入れる。merge したら【doc-fix】で知らせ、成果のページにも一覧で載せる。文書とコードが食い違うときは、コードの方に合わせる。

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
