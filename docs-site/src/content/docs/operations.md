---
title: 運用
description: この repo を別の folder へ移す手順、Node の version の上げ方、アクターの台帳（castlist）が止まった時、ページの置き場（pagetray）の起こし方と保ち方、レビュー（Staff Engineer 担当の席）と監査（Auditor の席）の運び、担当が落ちた後の調べ方
---

## 移す手順

1. TPM 担当のほかに動いている担当（Software Engineer・DevOps Engineer・Staff Engineer・Sustaining Engineer・Auditor）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（[信頼のダイアログ](/getting-started/#信頼のダイアログ)。信頼は path に付くので、移すたびに要る）。
4. 新しい folder の `cli/` で `pnpm install --frozen-lockfile` を打つ（`cd <新しい folder>/cli && pnpm install --frozen-lockfile`）。`~/.local/bin/tpm` の symlink を張っていれば張り直す（`ln -sf <新しい folder>/cli/bin/tpm ~/.local/bin/tpm`）。通知のバナーの hook（[設定](/configuration/#cmuxjson-に-hook-を足す)）を使っていれば、`tpm banner setup` を打ち直して `~/.config/cmux/cmux.json` の命令を替え、`tpm banner check` で確かめる（命令は repo の在り処を書いている）。
5. 動いている TPM 担当は、`tpm start` の 1 行で起こし直す（guard の hook と `tpm` の在り処が古い folder を指しているため）。担当を起こす旗は `tpm assign` が自分の場所から求めるので直さない。

使う側の project（TPM 担当を起こす folder）を移したときは、状態の folder（`~/.local/state/tpm/<project の path から作った名>/`）も変わる。担当が 0 のときに移せば、古い folder は消してよい。

## Node の version を上げる

1. repo の一番上の `.node-version` を新しい version（`26.14.0` のように patch まで）に書き替える。nodenv は `26` のような頭だけの version を受けない。GitHub Actions の 3 つの workflow も `node-version-file` でこのファイルを読むので、ほかは書き替えない。
2. 手元で `nodenv install` と、corepack の入れ直し（[Node と pnpm を入れる](/getting-started/#node-と-pnpm-を入れる)）。
3. 新しい version で試験と docs の検査を流してから PR にする（[開発](/development/)）。major を上げるときは `cli/package.json` と `docs-site/package.json` の `engines.node` と、`@types/node` も合わせる。

## レビュー（Staff Engineer 担当の席）

計画・提案・PR を、書いた者から離れた目で見るのは Staff Engineer 担当。席は、課題の担当がレビューを頼んだ時に、TPM 担当がその課題の隣に起こす（決まりは `skill-sets/core/.claude/skills/_shared/protocol.md` の「レビュー」）。Product Manager の手は、ふだんは無い。

- **必ずレビューを受けさせたい課題**は、TPM 担当に頼む時にそう言う（「この課題はレビューを受けさせて」）。TPM 担当が依頼書に「レビューを受ける」と書き、担当は計画と PR を必ず頼む。言わなければ、担当が要ると見た時だけ頼む。
- 頼まれると、cmux に `Staff <課題の Key>` の居場所ができる。Staff Engineer 担当は見る物と依頼書を読み、レビューのページ（置き場の一覧の UI で、役割 `staff-engineer`・種類 `review`）を置いて返す。課題管理の課題には「レビュー」の記録が付く。
- レビューは助言で、受けるかは課題の担当が決める。担当が「直すべき」を受けない時だけ TPM 担当に上がり、範囲・優先・設計の好みに関わる物は、TPM 担当が Product Manager に聞く。
- 席は、課題の担当の席と一緒に TPM 担当が閉じる。
- model などを替えるなら、TPM 担当に言う（`tpm assign --model`・`--effort`）か、`.claude/roles/config.jsonc` の `staff-engineer` に書く（[設定](/configuration/)）。既定は Opus 5.5・high。
- どれだけ頼まれ、どう判じられたかは、`tpm review list` で読める（TPM 担当に聞けばよい）。

```sh
tpm review list            # 頼みごとの行と、判定ごとの数・レビューを頼んでいない課題の数
tpm review list --key AI-12
```

出る行は「番号・課題の Key・判定（まだなら、席に渡していない・席が見ている・渡したが席がもう無い）・見る物・頼んだ時刻と返るまでの分・レビューのページ」。終わりの行の「レビューを頼んでいない課題」は、初めての頼みより後に結果の【done】を出した課題のうち、1 度も頼まなかった課題。頼む時を「いつも必ず」に上げるかを決める材料になる。

## 監査（Auditor の席）

監査は、Product Manager が呼んだ時にだけ始まる（自動では始まらない。目安は週 1）。Auditor は TPM 担当の回し方も見るので、席を起こすのも、呼ぶのも、報告を読んで答えるのも、Product Manager が `Audit` の席でじかにする。決まりは監査の規程（`skill-sets/core/.claude/skills/_shared/audit-charter.md`）。

### 席を起こす（初めと、tpm を動かす機械を起こし直した後）

cmux の中の shell で、TPM 担当を起こした folder に移って打つ。

```sh
cd <TPM 担当を起こした folder>
<roster の置き場所>/cli/bin/tpm audit start
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

- **2 度目からは、先に `/clear` を打つ。** 前の監査の文脈が残ったままだと、Auditor が自分の前の勧告を自分で追いかけることになる。`/clear` していなければ、Auditor は監査を始めずに止まり、`/clear` を頼む（`tpm audit begin` が、前の報告の後に `/clear` したかを記録で見る）。
- Auditor は件ごとの証拠集めを、会話の外の助手（`audit-evidence`。`context: fork`）に任せる。助手が返すのは事実と証拠の在り処と字だけで、Auditor は指摘に使う証拠を自分で開いて確かめてから、原因と勧告を書く。監査のページの指摘には「自分で確かめた証拠」が載る。
- 「[重い]」の件が台帳に入ると、TPM 担当が伝えてくる。調べさせるなら、`Audit` の席で `/audit <番号>` を呼ぶ。

### 報告を読んで、答える

1. 監査が済むと、`Audit` の席から通知のバナーが出る。席の画面に、要点と、決めてほしいこと（勧告ごとに、する・受け入れる・見送る）が出ている。詳しくは監査のページ（置き場の一覧の UI で、役割 `auditor`・種類 `audit`）。
2. **その席に答えを書く**（「R1 はする、R2 は受け入れる、R3 は見送る」）。TPM 担当を通さない。
3. Auditor が、受け入れた件を台帳に書き、決定を TPM 担当に渡す。TPM 担当は、「する」の勧告を課題にして担当に振る。TPM 担当が起きていなければ、Auditor はそう言って待つ（TPM 担当を起こした後に、送り直させる）。

### 席を閉じる・起こし直す

- 席は Product Manager が閉じる（cmux で居場所を閉じる）。TPM 担当は閉じられない。閉じても、監査のページ・台帳・監査線の記録（状態の folder の `audits.jsonl`）は残る。
- 閉じた・消えた後は、上の `tpm audit start` で起こし直す。

## アクターの台帳（castlist）

担当と Product Manager のアクターを残す、tpm を動かす機械の中だけのサーバー（別の repo の [castlist](https://uraitakahito.github.io/castlist/)。`tpm` が何を送るかは [担当のあいだの決まり](/protocol/#アクターの台帳castlist)、つなぐ設定は [設定](/configuration/#アクターの台帳castlist任意)）。**起こす・止める・data の volume を消すのは Product Manager だけ**で、命令は Product Manager が自分の terminal で直に打つ（手順は castlist の docs の「[動かす](https://uraitakahito.github.io/castlist/run.html)」）。

- castlist を設定した project で castlist が止まっていると、`tpm start`・`tpm assign`・`tpm audit start`・`tpm hello` は起こさず・名乗らずに止まり、打つ 1 行を出す。container（名は `castlist.box`。castlist 0.1.1 から）が在れば `container start castlist.box`、0.1.0 の docs の名 `castlist` の container だけが在ればその名で起こし直し、次に版を上げる時に名を替えるよう添える。どちらも無ければ `container run -d --name castlist.box -p 127.0.0.1:<port>:8080 -v castlist-data:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:<版>`（`<port>` は設定の URL の port、`<版>` は `cli/src/castlist.ts` の `CASTLIST_VERSION`）。初めて起こす時は、先に castlist の docs の「初めて起こす」（image の digest を見る・volume を作る）をする。
- 担当の居場所では、guard が Bash を止め、担当が TPM 担当に 1 行を渡す。TPM 担当は `tpm wait pm "castlist を起こす" --hand` で Product Manager に頼む。
- tpm を動かす機械を起こし直すと止まったままになる。`container system start` の後に `container start castlist.box` を打つ。
- 止めている間の session の始まりと終わりは、castlist に残らない（hook は送らずに終わる）。起きた後の初めの Bash で、guard が登録する。
- 監査では、Auditor が `tpm castlist find`・`tpm castlist show`・`tpm castlist lineage`・`tpm castlist events`・`tpm castlist settings` でアクターを引く（読むだけ。[担当のあいだの決まり](/protocol/#監査の検索を読む)）。止まっている間は `castlist に聞けない` の 1 行で止まり、`tpm incident timeline` はアクターの欄に「castlist に聞けない」と書いてページを置く。
- 答えを手で確かめ直す時だけ、castlist を動かす機械の terminal で、同じ GET を `curl` で打つ（例 `curl -s 'http://127.0.0.1:8802/v1/actors?label=tpm.key%3At-23zs'`。時刻の `+` は `%2B` に。引数は castlist の docs の [API](https://uraitakahito.github.io/castlist/api.html)）。ふだんは `tpm castlist …` を使う（名を id にし、行ごとにプロフィールの画面の URL を添える）。書く要求（POST・PUT）は手で送らない。

## ページの置き場（pagetray）

依頼書と成果のページを置く、tpm を動かす機械の中だけの置き場。担当が `tpm page put` で置いたページを DB に持ち、絞って探せる一覧の UI を出すサーバー（別の repo の [pagetray](https://github.com/uraitakahito/pagetray)。この repo とのつなぎは [開発](/development/#pagetrayページの置き場のサーバーとのつなぎ)）を、Apple Container（`container` CLI）で動かす。`127.0.0.1` だけで待ち受け、LAN にもインターネットにも開かない。起こす・止める・直すのは DevOps Engineer 担当で、命令は `tpm infra run pagetray -- <命令>` で打つ（この repo と pagetray の repo の `.claude/roles/config.jsonc` が、環境 `pagetray` を「TPM に相談」の手続きで宣言している）。

| 物 | 値 |
|---|---|
| image | `ghcr.io/uraitakahito/pagetray:<版>`。版と digest は、この repo の `.pagetray-version`（`v<版>@<digest>`。この repo の cli と合わせてある版） |
| container | `pagetray`（`127.0.0.1:8801` と `127.0.0.1:8800` → 中の 8080。メモリは Apple Container の下限の 200 MiB、CPU は 1） |
| URL | `http://127.0.0.1:8801/`（一覧の UI。ページは `/<状態の folder の名>/<Key>/<種類>-<番号>.html`、ページが参照する file は `/<状態の folder の名>/<Key>/files/<語>-<番号>.<拡張子>`）。`http://127.0.0.1:8800/` は、前の置き場（Nginx。今は無い）の port。前に置いたページの URL と、ページの中の link を同じ path で開けるように、同じ container が待ち受ける |
| CLI | `pagetray`（置き場を端末から操作する命令。release に macOS arm64 用の binary が付く。入れ方と命令は pagetray の docs の「[CLI](https://uraitakahito.github.io/pagetray/cli.html)」）。担当は `tpm page` を使い、`pagetray` は人の手元と、`tpm` を通さない場面で使う。担当の `pagetray page delete` は guard が止める |
| 控えの folder | `~/.local/share/tpm/pages/`（`tpm` が、置いた・読んだページと file を tpm を動かす機械に写す所。container には mount しない） |
| DB | 名前つきの volume `pagetray-data`（中の `/data/pages.db`）。tpm を動かす機械の folder は mount しない |

**手順は、pagetray の docs の「[動かす](https://uraitakahito.github.io/pagetray/run.html)」にある**（起こす・確かめる・DB の写しを取る・写しから戻す・止める・版を上げる）。そこの命令のうち、container と volume に触る物は、頭に `tpm infra run pagetray --` を付けて打つ。下は、この repo の側の決まりだけを書く。

### 起こす

```sh
container image pull ghcr.io/uraitakahito/pagetray:<版>
container volume create pagetray-data     # 初めての時だけ
tpm infra run pagetray -- container run -d --name pagetray \
  -p 127.0.0.1:8801:8080 \
  -p 127.0.0.1:8800:8080 \
  -v pagetray-data:/data \
  -m 200M -c 1 \
  -e PAGETRAY_CASTLIST_URL=http://castlist.box:8080 \
  ghcr.io/uraitakahito/pagetray:<版>
```

- `<版>` は `.pagetray-version` の `@` の前（`v0.2.0` など）。pull した image の digest が `@` の後ろと同じかを見る（見方は pagetray の docs の「[起こす](https://uraitakahito.github.io/pagetray/run.html#起こす)」）。
- `-p` には必ず `127.0.0.1:` を書く。`-p 8801:8080` と書くと LAN に開く。
- `PAGETRAY_CASTLIST_URL`（pagetray 0.6.0 から）は、置き場が送り手を castlist（[アクターの台帳](#アクターの台帳castlist)）に聞く先。`tpm page put`・`tpm file put` は、castlist の設定がある project では送り手（session の付随する id）を付けて置き、置き場が受けたその時に castlist に聞いて記録に残す（[担当のあいだの決まり](/protocol/#ページの置き場)）。container の中の `127.0.0.1` は container 自身なので、castlist の container `castlist.box` に名でつなぐ（Apple Container の DNS が domain `box` の名を答える）。一覧の UI の送り手の link の頭 `PAGETRAY_CASTLIST_LINK_URL` は、既定の `http://127.0.0.1:8802`（host の browser で開く castlist）のままにする。
- `PAGETRAY_CASTLIST_URL` を書いた置き場は、castlist が止まっている・名で届かない間、送り手を付けた置く要求を `503` で断る（何も置かない。`tpm page put` は「castlist に送り手を聞けませんでした」と出す）。castlist を起こすのは Product Manager（[アクターの台帳](#アクターの台帳castlist)）。castlist が起きているのに続く時は、置き場から `castlist.box` に届いていない（同じ network に居ない・名が違う）。
- 8801 が使われていたら別の port にし、担当が使う URL を環境変数 `TPM_PAGES_URL`（[設定](/configuration/)）で合わせる。
- 起こしたら、pagetray の docs の「[確かめる](https://uraitakahito.github.io/pagetray/run.html#確かめる)」をする。試しのページを置いたら、TPM 担当が `tpm page delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。
- 「確かめる」の 6（一覧の UI を、読むだけの試験で見る。pagetray 0.3.2 から）は、DevOps Engineer 担当が自分で流す。pagetray の checkout のある folder で打ち、Node と pnpm が要る。試験は本物の browser（tpm を動かす機械の Chrome）で一覧の UI を開くが、置き場には何も書かない。出力を結果のページに載せる。browser で一覧を見ることを、Product Manager に頼まない。試験が落ちたら、落ちた所を【ask-tpm】で知らせる。

### 止める・tpm を動かす機械を起こし直した後

- 止めている間、担当はページを置けず、Product Manager は一覧の UI を開けない（番号をサーバーが決めるため。担当は、控えにあるページなら読める）。先に【ask-tpm】を送り、答えを待つ。止めるのは `tpm infra run pagetray -- container stop pagetray`。DB は volume に残る。
- tpm を動かす機械を起こし直すと止まったままになる。`container system start` の後に `tpm infra run pagetray -- container start pagetray` を打ち、「確かめる」をする。
- volume（`pagetray-data`）は消さない。消す命令も「TPM に相談」の手続きに入れてある。
- **DB の写し**（`curl -fsS -o ~/pagetray-$(date +%Y%m%d-%H%M).db http://127.0.0.1:8801/api/backup`。CLI が入っていれば `pagetray backup -o ~/pagetray-$(date +%Y%m%d-%H%M).db` でも同じ）は、版を上げる前と volume に触る前に取る。本文は控えの folder にも残るが、置いた担当の役割と workspace の ID は DB にだけある。

### 控えから取り込む

DB を失い、写しも無くて、空の volume で起こした時は、控えの folder のページを置き場に入れる。

```sh
tpm page import
```

- 控えにあって置き場に無いページと file（`<Key>/files/`）を、同じ番号・file の時刻で入れる。何度打っても同じ結果になる。file を入れるのは、file を扱える置き場（0.4.0 から）だけ。
- 置いた担当はわからないので、役割は依頼書と課題の写しだけ `tpm`、ほかは `unknown`、居場所は空で入る（DB の写しから戻せば、これらも戻る）。
- 「消したページ」と出た物は、置き場で消した番号（`tpm page delete`）。控えにだけ残っていた物で、入れない。
- 「ぶつかった」と出たページは、同じ番号に別の中身が置き場にある。入れていないので、要る物なら `tpm page put` で置き直す。

### 版を上げる

pagetray の新しい版が出て、この repo の `.pagetray-version` が上がった時（上げ方は [開発](/development/#pagetrayページの置き場のサーバーとのつなぎ)の「pagetray を上げる時」）。

1. pagetray の `CHANGELOG.md` で、API の版が変わるか・移行の SQL が足されるかを見る。
2. 【ask-tpm】で止める時を決める。
3. pagetray の docs の「[版を上げる](https://uraitakahito.github.io/pagetray/run.html#版を上げる)」のとおりに、DB の写しを取り、container を作り直して、確かめる（volume はそのまま付く）。「確かめる」は、6 の読むだけの試験まで流す。
4. `tpm page` が「API の版が違う」と言って止まる時は、置き場の版とこの repo の版（`.pagetray-version`）が合っていない。どちらかが古いので、合わせる。`tpm file` が「置き場（pagetray）の版が古く」と言って止まる時は、置き場が 0.4.0 より前。`tpm ask pm`・`tpm answer` が「置き場の印: 付けていない（置き場の版が古く…）」と出す時と、`tpm page reply` が「版が古く」と言って止まる時は、置き場が 0.5.0 より前（返事の状態を持てない）。`.pagetray-version` の版に上げる。
5. **0.5.0 に上げる時**: 移行の SQL が足される版なので、上げた後の DB では 0.4.2 までの版は起きない。戻す道は、3 で取った DB の写しだけ（写しの後に置かれたページと file は、`tpm page import` で控えから入れ直す）。上げた直後は、返事待ちは 0 件（前からあるページには印が付かない）。
6. **0.6.0 に上げる時**: これも移行の SQL が足される版で、上げた後の DB では 0.5.0 までの版は起きない（戻す道は 3 の写しだけ）。作り直す `container run` に、上の「起こす」の `-e PAGETRAY_CASTLIST_URL=http://castlist.box:8080` を足す。前からあるページと file には、送り手は付かない。0.6.0 より前の置き場は、`tpm` が付けた送り手を読まずに置く（記録に残らないだけで、止まらない）。

### 秘密を上げてしまった時

担当が token などの写った file を上げてしまったら、TPM 担当が `tpm file delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。置き場の DB からは消えるが、**前に取った DB の写し（`~/pagetray-*.db`）には残る**。消した後に新しく写しを取り、古い写しを消す。その token は、漏れた物として取り消す（作り直す）。

### ほかの project で使う

置き場は tpm を動かす機械に 1 つで、どの project の担当も同じ置き場を使う（一覧の UI では project で絞れる）。ほかの project で TPM 担当を起こすときも、その project の `.claude/roles/config.jsonc` に、この repo と同じ `infra.pagetray` の宣言を写す（写さないと、その project の担当は止める命令を断りなく打てる。[設定](/configuration/#環境の手続き)）。

## 担当が落ちた後の調べ方

担当の Claude Code の session・cmux・container が思わず止まった時に、何が・いつ・どの process の合図で止まったかを、後から引く手順。2026-11-23 の朝（05:33:17 JST）に、担当の session が打った `pkill -f "castlist-server" -n` が、command line に `-n` を含む process すべてに SIGTERM を送り、担当の session 3 つ・cmux-cua の helper・container がいっせいに止まった件（台帳 #89）は、この 3 つの手で元まで追えた。見張りは置いていないので、記録は macOS と Claude Code が元から残す物だけ。

- 打つのは読むだけの命令に限る。process を止める・合図を送る命令は、確かめのためにも打たない。
- 分かった事実は `tpm report incident` で台帳に書く（[担当のあいだの決まり](/protocol/#台帳)）。原因を調べ、扱いを決めるのは Auditor。
- 下の命令の日時は、今朝の件の値。落ちた時刻に替えて打つ。

### 先に、刈られる前に残す

macOS の記録（unified log）は、OS が古い物から自分で刈る（目安は約 3 週間）。Claude Code の transcript も、既定では 30 日で消える。落ちたと気づいたら、日を置かずに 1 と 3 の行を file に書き出しておく（`… > ~/crash-20261123.log`。tpm を動かす機械の中に置き、外に写さない）。

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
- 時刻は tpm を動かす機械の時間帯で書き、そのまま出る。
- `exited due to` の後ろが終わり方（SIGTERM・SIGKILL など）、`sent by` の後ろが合図を送った process と pid。`sent by launchd[1]` は launchd が止めた（上の行の daemon が止まった後の片付けなど）。今朝は、`pkill[89723]` が先に container の network の daemon を止め、約 1 分後に launchd が container の runtime を止めた。
- 出るのは launchd の job だけ（cmux の helper `application.com.cmuxterm.…`、container の daemon `com.apple.container.…`、container ごとの runtime `com.apple.container.container-runtime-linux.<container の名>`）。Claude Code の session は launchd の job でないので出ない。session は 2 で見る。
- `mdworker`（Spotlight）が `sent by mds` で止まる行は、いつも多く出るので grep で外す。job の名（`[gui/501/…]` の所）は `--predicate` の `eventMessage` に入らないので、名で絞るのも grep でする。
- 送り手の pid（`pkill[89723]`）からは、打った session は分からない。2 で、その時刻の少し前に打たれた命令を探す。

### 2. transcript から、最後の時刻と打った命令を引く

transcript は `<Claude Code の設定の folder>/projects/<起こした folder の path の / を - にした名>/<session の id>.jsonl`（設定の folder は `CLAUDE_CONFIG_DIR`、無ければ `~/.claude`）。中の時刻は UTC（`Z`）。

落ちた頃に書くのが止まった transcript ごとに、最後の時刻・file・最後に打った命令を出す。落ちた session はその後に書き足されないので、file の更新の時刻が落ちた頃に入る（`-newermt` の日時は tpm を動かす機械の時間帯）。

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
- file の名が session の id。どの担当の session かは、Auditor が `tpm castlist` で引く（[アクターの台帳](#アクターの台帳castlist)）。

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
