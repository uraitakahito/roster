---
title: 運用
description: この repo を別の folder へ移す手順、Node の version の上げ方、ページの置き場（tpm-pagestore）の起こし方と保ち方
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

## ページの置き場（tpm-pagestore）

依頼書と成果のページを置く、この Mac だけの置き場。担当が `tpm page put` で置いたページを DB に持ち、絞って探せる一覧の UI を出すサーバー（`pagestore/`。作りは [開発](/development/#pagestorerust-の置き場)）を、Apple Container（`container` CLI）で動かす。`127.0.0.1` だけで待ち受け、LAN にもインターネットにも開かない。起こす・止める・直すのは DevOps Engineer 担当で、命令は `tpm infra run tpm-pagestore -- <命令>` で打つ（この repo の `.claude/roles/config.jsonc` が、環境 `tpm-pagestore` を「TPM に相談」の手続きで宣言している）。

| 物 | 値 |
|---|---|
| container | `tpm-pagestore`（`127.0.0.1:8801` と `127.0.0.1:8800` → 中の 8080。メモリは Apple Container の下限の 200 MiB、CPU は 1） |
| URL | `http://127.0.0.1:8801/`（一覧の UI。ページは `/<状態の folder の名>/<Key>/<種類>-<番号>.html`）。`http://127.0.0.1:8800/` は、前の置き場（Nginx。今は無い）の port。前に置いたページの URL と、ページの中の link を同じ path で開けるように、同じ container が待ち受ける |
| 控えの folder | `~/.local/share/tpm/pages/`（`tpm` が、置いた・読んだページをこの Mac に写す所。container には mount しない） |
| DB | 名前つきの volume `tpm-pagestore-data`（中の `/data/pages.db`）。Mac の folder は mount しない |
| image | この Mac で `pagestore/Containerfile` から作る `tpm-pagestore:<commit の短い名>`。registry には上げない |

### image を作る

```sh
git -C <この repo> pull --ff-only
cd <この repo>/pagestore
container build --progress plain -t tpm-pagestore:$(git rev-parse --short HEAD) -f Containerfile .
```

- 初めからで 2 分ほど。`--progress plain` を付ける（`-q` は止まったまま進まないことがあった）。
- build の段は公式の `rust` の alpine で、tag と digest で固定してある。SQL の検査は commit した `pagestore/.sqlx/` で行うので、build の中に DB は要らない。

### 起こす

```sh
container volume create tpm-pagestore-data     # 初めての時だけ
tpm infra run tpm-pagestore -- container run -d --name tpm-pagestore \
  -p 127.0.0.1:8801:8080 \
  -p 127.0.0.1:8800:8080 \
  -v tpm-pagestore-data:/data \
  -m 200M -c 1 \
  tpm-pagestore:<commit の短い名>
```

- `-p` には必ず `127.0.0.1:` を書く。`-p 8801:8080` と書くと LAN に開く。
- 2 行目の `-p`（8800）は、前の置き場の URL のため。新しいページの URL は 8801 で出る。
- 8801 が使われていたら別の port にし、この節の URL と 1 行を合わせて直す。担当が使う URL も、環境変数 `TPM_PAGES_URL`（[設定](/configuration/)）で合わせる。
- 起きる時に、まだ当てていない移行の SQL（`pagestore/migrations/`）を DB に当てる。

### 確かめる

1. `container list` で `tpm-pagestore` が `running`。
2. `lsof -nP -iTCP:8801 -iTCP:8800 -sTCP:LISTEN` が `127.0.0.1:8801` と `127.0.0.1:8800` だけを出す（`*:` で始まる行があれば LAN に開いている）。
3. `curl -s http://127.0.0.1:8801/healthz` が `ok` を返し、`curl -s 'http://127.0.0.1:8801/api/pages?limit=1'` が JSON を返す。browser で `http://127.0.0.1:8801/` が一覧を出す。`curl -s http://127.0.0.1:8800/healthz` も `ok` を返す。
4. `container logs tpm-pagestore` の頭に `pagestore <版> listen=0.0.0.0:8080 db=/data/pages.db` が出ている。
5. `container stats --no-stream tpm-pagestore` のメモリが数 MiB〜20 MiB ほど（初めて起こした直後と、たくさん置いた直後は、OS が file を覚えている分で 50 MiB を超えることがある。起こし直すと戻る）。

試しのページは置かない（置いたページを消す口は無い）。

### DB の写しを取る

本文は、担当が置いた時に Mac の控えの folder（`~/.local/share/tpm/pages/`）にも残る。置いた担当の役割と workspace の ID は DB にだけあるので、**image を上げる前と、volume に触る前**に、DB の写しを取る。動かしたまま取れる。

```sh
curl -fsS -o ~/tpm-pagestore-$(date +%Y%m%d-%H%M).db http://127.0.0.1:8801/api/backup
sqlite3 ~/tpm-pagestore-<日時>.db 'select count(*) from pages'    # 開けて、件数が合うか
```

### 写しから戻す

volume を失った・DB が壊れた時。先に【ask-tpm】を送り、答えを待つ（戻す間、担当はページを置けない）。

```sh
tpm infra run tpm-pagestore -- container stop tpm-pagestore
tpm infra run tpm-pagestore -- container run --rm \
  -v tpm-pagestore-data:/data -v "<写しのある folder>:/in:ro" \
  <pagestore/Containerfile の 1 つ目の FROM の image> \
  sh -c 'rm -f /data/pages.db-wal /data/pages.db-shm && cp /in/<写しの file> /data/pages.db'
tpm infra run tpm-pagestore -- container start tpm-pagestore
```

- 動かす image は空で `cp` も無いので、file を volume に入れる時だけ、build の段の image（もうこの Mac にある）を借りる。
- 起こしたら「確かめる」をし、`curl -s 'http://127.0.0.1:8801/api/pages?limit=1'` で一番新しいページを見る。
- 写しが無ければ、空の volume で起こし、下の「控えから取り込む」をする（役割と workspace の ID は戻らない）。

### 控えから取り込む

DB を失って空の volume で起こした時は、控えの folder のページを置き場に入れる。

```sh
tpm page import
```

- 控えにあって置き場に無いページを、同じ番号・file の時刻で入れる。何度打っても同じ結果になる。
- 置いた担当はわからないので、役割は依頼書と課題の写しだけ `tpm`、ほかは `unknown`、居場所は空で入る（DB の写しから戻せば、これらも戻る）。
- 「ぶつかった」と出たページは、同じ番号に別の中身が置き場にある。入れていないので、要る物なら `tpm page put` で置き直す。

### 止める・Mac を起こし直した後

- 止めている間、担当はページを置けず、Product Manager は一覧の UI を開けない（番号をサーバーが決めるため。担当は、控えにあるページなら読める）。先に【ask-tpm】を送り、答えを待つ。止めるのは `tpm infra run tpm-pagestore -- container stop tpm-pagestore`。DB は volume に残る。
- Mac を起こし直すと止まったままになる。`container system start` の後に `tpm infra run tpm-pagestore -- container start tpm-pagestore` を打ち、「確かめる」をする。
- volume（`tpm-pagestore-data`）は消さない。消す命令も「TPM に相談」の手続きに入れてある。

### image を上げる

`pagestore/` のコードが変わった時。

1. 「image を作る」で、新しい commit の名の image を作る。
2. 「DB の写しを取る」をする。
3. 【ask-tpm】で止める時を決めてから、`container stop tpm-pagestore`・`container delete tpm-pagestore` を `tpm infra run tpm-pagestore --` で打ち、新しい image の名で「起こす」の 1 行を打って「確かめる」をする（volume はそのまま付く）。
4. 古い image は `container image delete` で消す。

build の段の `rust` の image を上げる時は、`pagestore/rust-toolchain.toml` と同じ版の alpine を選び、`pagestore/Containerfile` の tag と digest を合わせて直す PR を出す（tag は rebuild で中身が替わるので、digest まで書く）。

### ほかの project で使う

置き場は Mac に 1 つで、どの project の担当も同じ置き場を使う（一覧の UI では project で絞れる）。ほかの project で TPM 担当を起こすときも、その project の `.claude/roles/config.jsonc` に、この repo と同じ `infra.tpm-pagestore` の宣言を写す（写さないと、その project の担当は止める命令を断りなく打てる。[設定](/configuration/#環境の手続き)）。
