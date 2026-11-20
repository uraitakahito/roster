---
title: 運用
description: この repo を別の folder へ移す手順、Node の version の上げ方、代わりの置き場（tpm-pages）の起こし方
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

## 代わりの置き場（tpm-pages）

依頼書と成果の HTML を置く、この Mac だけの置き場。local の folder を読むだけで mount した Nginx を、Apple Container（`container` CLI）で動かす。`127.0.0.1` だけで待ち受け、LAN にもインターネットにも開かない。起こす・止める・直すのは DevOps Engineer 担当で、命令は `tpm infra run tpm-pages -- <命令>` で打つ（この repo の `.claude/roles/config.jsonc` が、環境 `tpm-pages` を「TPM に相談」の手続きで宣言している）。

| 物 | 値 |
|---|---|
| 置き場の folder | `~/.local/share/tpm/pages/`（`<状態の folder の名>/<鍵>/<種類>-<番号>.html` と並ぶ） |
| URL | `http://127.0.0.1:8800/`（folder の並びがそのまま path になる。folder の URL は一覧を出す） |
| Nginx の設定 | `skill-sets/core/infra/tpm-pages/default.conf`（utf-8・一覧・`Cache-Control: no-cache`） |
| image | 公式の `nginx` の stable の alpine。tag と digest で固定する（下の起こし方の 1 行） |

### 起こす

```sh
mkdir -p ~/.local/share/tpm/pages
tpm infra run tpm-pages -- container run -d --name tpm-pages \
  -p 127.0.0.1:8800:80 \
  -v "$HOME/.local/share/tpm/pages:/usr/share/nginx/html:ro" \
  -v "<この repo>/skill-sets/core/infra/tpm-pages:/etc/nginx/conf.d:ro" \
  -e TZ=Asia/Tokyo \
  docker.io/library/nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
```

- `-p` には必ず `127.0.0.1:` を書く。`-p 8800:80` と書くと LAN に開く。
- 8800 が使われていたら別の port にし、この節の URL と 1 行を合わせて直す。

### 確かめる

1. `container list` で `tpm-pages` が `running`。
2. `lsof -nP -iTCP:8800 -sTCP:LISTEN` が `127.0.0.1:8800` だけを出す（`*:8800` なら LAN に開いている）。
3. `~/.local/share/tpm/pages/_check/index.html` に日本語の HTML を置き、`curl -si http://127.0.0.1:8800/_check/` が `200` と `Content-Type: text/html; charset=utf-8` を返す。`curl -s http://127.0.0.1:8800/` が folder の一覧を返す。
4. 確かめた `_check` の folder を消す。

### 止める・Mac を起こし直した後

- 止めると、並べて動いている担当がみな依頼書と成果を開けなくなる。先に【相談(TPM)】を送り、答えを待つ。止めるのは `tpm infra run tpm-pages -- container stop tpm-pages`。
- `container run` に restart の決まりは無いので、Mac を起こし直すと止まったままになる。開けないと頼まれたら、`container system start` の後に `tpm infra run tpm-pages -- container start tpm-pages` を打ち、上の「確かめる」をする。

### image を上げる

1. 公式の `nginx` の stable の alpine から、公開から 2 週間以上たった版を選ぶ（tag は rebuild で中身が替わるので、digest まで書く）。
2. この節の 1 行の tag と digest を直す PR を出し、merge する。
3. 【相談(TPM)】で止める時を決めてから、`container stop tpm-pages`・`container delete tpm-pages` を `tpm infra run tpm-pages --` で打ち、新しい 1 行で起こし直して「確かめる」をする。古い image は `container image delete` で消す。

### ほかの project で使う

置き場は Mac に 1 つで、どの project の担当も同じ置き場を使う。ほかの project で TPM 担当を起こすときも、その project の `.claude/roles/config.jsonc` に、この repo と同じ `infra.tpm-pages` の宣言を写す（写さないと、その project の担当は止める命令を断りなく打てる。[設定](/configuration/#環境の手続き)）。
