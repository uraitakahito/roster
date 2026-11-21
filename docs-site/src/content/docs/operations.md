---
title: 運用
description: この repo を別の folder へ移す手順、Node の version の上げ方、ページの置き場（pagetray）の起こし方と保ち方
---

## 移す手順

1. TPM 担当のほかに動いている担当（Software Engineer・DevOps Engineer・Sustaining Engineer）が 0 のときに行う。
2. `mv <今の folder> <新しい folder>`（git の履歴ごと移る）。
3. 新しい folder で 1 度 Claude Code を対話で起こして信頼する（[信頼のダイアログ](/getting-started/#信頼のダイアログ)。信頼は path に付くので、移すたびに要る）。
4. 新しい folder で `pnpm --dir cli install --frozen-lockfile` を打つ。`~/.local/bin/tpm` の symlink を張っていれば張り直す（`ln -sf <新しい folder>/cli/bin/tpm ~/.local/bin/tpm`）。
5. 動いている TPM 担当は、`tpm start` の 1 行で起こし直す（guard の hook と `tpm` の在り処が古い folder を指しているため）。担当を起こす旗は `tpm assign` が自分の場所から求めるので直さない。

使う側の project（TPM 担当を起こす folder）を移したときは、状態の folder（`~/.local/state/tpm/<project の path から作った名>/`）も変わる。担当が 0 のときに移せば、古い folder は消してよい。

## Node の version を上げる

1. repo の一番上の `.node-version` を新しい version（`26.14.0` のように patch まで）に書き替える。nodenv は `26` のような頭だけの version を受けない。GitHub Actions の 3 つの workflow も `node-version-file` でこのファイルを読むので、ほかは書き替えない。
2. 手元で `nodenv install` と、corepack の入れ直し（[Node と pnpm を入れる](/getting-started/#node-と-pnpm-を入れる)）。
3. 新しい version で試験と docs の検査を流してから PR にする（[開発](/development/)）。major を上げるときは `cli/package.json` と `docs-site/package.json` の `engines.node` と、`@types/node` も合わせる。
4. merge して新しい Node に替えた後、`tpm banner setup` を打ち直し、出た命令で `~/.config/cmux/cmux.json` の hook を替える（hook の命令は Node の folder を path で書いている）。`tpm banner check` で確かめる。

## ページの置き場（pagetray）

依頼書と成果のページを置く、この Mac だけの置き場。担当が `tpm page put` で置いたページを DB に持ち、絞って探せる一覧の UI を出すサーバー（別の repo の [pagetray](https://github.com/uraitakahito/pagetray)。この repo とのつなぎは [開発](/development/#pagetrayページの置き場のサーバーとのつなぎ)）を、Apple Container（`container` CLI）で動かす。`127.0.0.1` だけで待ち受け、LAN にもインターネットにも開かない。起こす・止める・直すのは DevOps Engineer 担当で、命令は `tpm infra run pagetray -- <命令>` で打つ（この repo と pagetray の repo の `.claude/roles/config.jsonc` が、環境 `pagetray` を「TPM に相談」の手続きで宣言している）。

| 物 | 値 |
|---|---|
| image | `ghcr.io/uraitakahito/pagetray:<版>`。版と digest は、この repo の `.pagetray-version`（`v<版>@<digest>`。この repo の cli と合わせてある版） |
| container | `pagetray`（`127.0.0.1:8801` と `127.0.0.1:8800` → 中の 8080。メモリは Apple Container の下限の 200 MiB、CPU は 1） |
| URL | `http://127.0.0.1:8801/`（一覧の UI。ページは `/<状態の folder の名>/<Key>/<種類>-<番号>.html`、ページが参照する file は `/<状態の folder の名>/<Key>/files/<語>-<番号>.<拡張子>`）。`http://127.0.0.1:8800/` は、前の置き場（Nginx。今は無い）の port。前に置いたページの URL と、ページの中の link を同じ path で開けるように、同じ container が待ち受ける |
| CLI | `pagetray`（置き場を端末から操作する命令。release に macOS arm64 用の binary が付く。入れ方と命令は pagetray の docs の「[CLI](https://uraitakahito.github.io/pagetray/cli.html)」）。担当は `tpm page` を使い、`pagetray` は人の手元と、`tpm` を通さない場面で使う。担当の `pagetray page delete` は guard が止める |
| 控えの folder | `~/.local/share/tpm/pages/`（`tpm` が、置いた・読んだページと file をこの Mac に写す所。container には mount しない） |
| DB | 名前つきの volume `pagetray-data`（中の `/data/pages.db`）。Mac の folder は mount しない |

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
  ghcr.io/uraitakahito/pagetray:<版>
```

- `<版>` は `.pagetray-version` の `@` の前（`v0.2.0` など）。pull した image の digest が `@` の後ろと同じかを見る（見方は pagetray の docs の「[起こす](https://uraitakahito.github.io/pagetray/run.html#起こす)」）。
- `-p` には必ず `127.0.0.1:` を書く。`-p 8801:8080` と書くと LAN に開く。
- 8801 が使われていたら別の port にし、担当が使う URL を環境変数 `TPM_PAGES_URL`（[設定](/configuration/)）で合わせる。
- 起こしたら、pagetray の docs の「[確かめる](https://uraitakahito.github.io/pagetray/run.html#確かめる)」をする。試しのページを置いたら、TPM 担当が `tpm page delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。
- 「確かめる」の 6（一覧の UI を、読むだけの試験で見る。pagetray 0.3.2 から）は、DevOps Engineer 担当が自分で流す。pagetray の checkout のある folder で打ち、Node と pnpm が要る。試験は本物の browser（この Mac の Chrome）で一覧の UI を開くが、置き場には何も書かない。出力を結果のページに載せる。browser で一覧を見ることを、Product Manager に頼まない。試験が落ちたら、落ちた所を【ask-tpm】で知らせる。

### 止める・Mac を起こし直した後

- 止めている間、担当はページを置けず、Product Manager は一覧の UI を開けない（番号をサーバーが決めるため。担当は、控えにあるページなら読める）。先に【ask-tpm】を送り、答えを待つ。止めるのは `tpm infra run pagetray -- container stop pagetray`。DB は volume に残る。
- Mac を起こし直すと止まったままになる。`container system start` の後に `tpm infra run pagetray -- container start pagetray` を打ち、「確かめる」をする。
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
4. `tpm page` が「API の版が違う」と言って止まる時は、置き場の版とこの repo の版（`.pagetray-version`）が合っていない。どちらかが古いので、合わせる。`tpm file` が「置き場（pagetray）の版が古く」と言って止まる時は、置き場が 0.4.0 より前。`.pagetray-version` の版に上げる。

### 秘密を上げてしまった時

担当が token などの写った file を上げてしまったら、TPM 担当が `tpm file delete <URL> --yes` で消す（[担当のあいだの決まり](/protocol/#ページの置き場)）。置き場の DB からは消えるが、**前に取った DB の写し（`~/pagetray-*.db`）には残る**。消した後に新しく写しを取り、古い写しを消す。その token は、漏れた物として取り消す（作り直す）。

### ほかの project で使う

置き場は Mac に 1 つで、どの project の担当も同じ置き場を使う（一覧の UI では project で絞れる）。ほかの project で TPM 担当を起こすときも、その project の `.claude/roles/config.jsonc` に、この repo と同じ `infra.pagetray` の宣言を写す（写さないと、その project の担当は止める命令を断りなく打てる。[設定](/configuration/#環境の手続き)）。
