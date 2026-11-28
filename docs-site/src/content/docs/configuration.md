---
title: 設定
description: 使う側の project に置く .claude/roles/config.jsonc（課題管理・連携・インフラの環境・担当の既定・アクターの台帳。直下の folder の設定も合わせる）、model などの既定を人ごとに決める環境変数、ページの置き場の環境変数、Dependabot の skill の設定
---

## `.claude/roles/config.jsonc`（任意）

TPM 担当を起こした folder（project）に置くと、道具の選び方・追加の skill セット・起こす担当の既定を替えられる。`roster` の命令が読む。project の直下の folder にも設定があれば、集めて 1 つに合わせる（下の「[直下の folder の設定](#直下の-folder-の設定)」）。JSONC（`//`・`/* */` のコメントと、`}`・`]` の前の末尾のカンマを許す JSON）で書く。

古い名前の `.claude/roles/config.json` があると、`roster` の命令はそれを読まずに止まる。`config.jsonc` が無ければ名前を替える `mv` を出す（中身はそのまま JSONC として読めるので、名前を替えるだけで移せる）。両方あれば、`config.json` を消すよう言う（要る中身は先に `config.jsonc` へ移す）。

| 欄 | 中身 | 無いとき |
|---|---|---|
| `tracker` | 課題管理の道具。`jira`（acli）・`github`（その folder の repo の Issue。gh）・`none` | `none`（課題に記録を書かない） |
| `transport` | 連携の道具（担当の居場所を作り、題と状態を見せる。メッセージは運ばない）。`cmux`（`file` は試験用） | `cmux` |
| `messages` | 担当どうしのメッセージを配る道。書けるのは `nats`（NATS JetStream）だけで、書いても書かなくても同じ（下の「[メッセージを配る道](#メッセージを配る道)」）。前の版の `cmux` は誤りで止まる | `nats`（いつも NATS で配る） |
| `infra` | インフラの環境の宣言。環境の名前（英小文字・数字・`-`）ごとに `guard`（手続き）と `match`（その環境に触る命令の語の並びの配列。語の末尾の `*` は前方一致） | 宣言なし（guard は環境を見ない） |
| `skill-sets` | core のほかに加える、追加の skill セットの名前の配列 | core だけ |
| `folders` | 設定を集める folder（project の folder からの path）の配列。書くと、直下を探さずに書いた folder だけを集める。`[]` なら集めない | 直下の folder のうち、設定がある物を全部集める |
| `castlist` | アクターの台帳（castlist）の URL（`http://127.0.0.1:<port>` か `http://localhost:<port>`）。project の folder の設定だけが効く（下の「[アクターの台帳（castlist）](#アクターの台帳castlist任意)」） | castlist に何も送らない |
| `software-engineer`・`tech-lead`・`devops-engineer`・`staff-engineer`・`auditor` | 起こす担当の `model`・`effort`・`permissionMode` | [環境変数](#model-などの既定の環境変数任意)、それも無ければ既定（Software Engineer 担当と Tech Lead 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、Staff Engineer 担当は Opus 5.5・high、Auditor は Fable 5.2・high、どれも `bypassPermissions`） |

```jsonc
{
  // 課題の記録は、この folder の repo の GitHub の Issue に書く
  "tracker": "github",
  "transport": "cmux",
  "infra": {
    "apple-container": {
      "guard": "free",
      "match": ["container "],
    },
    /* staging はほかのチームも使うので、
       Product Manager の承認が要る */
    "aws-staging": {
      "guard": "pm",
      "match": ["aws ", "ssh staging"],
    },
  },
  "skill-sets": ["dependabot"],
  "software-engineer": {
    "model": "claude-opus-5-5",
    "effort": "high",
    "permissionMode": "bypassPermissions",
  },
  "devops-engineer": {
    "model": "claude-opus-5-5",
    "effort": "low",
    "permissionMode": "bypassPermissions",
  },
  "staff-engineer": {
    "model": "claude-opus-5-5",
    "effort": "high",
    "permissionMode": "bypassPermissions",
  },
  "auditor": {
    "model": "claude-fable-5-2",
    "effort": "high",
    "permissionMode": "bypassPermissions",
  },
}
```

### 直下の folder の設定

いくつもの repo を置いた上の folder で TPM 担当を起こし、1 つの課題で下の repo をまたいで触るときのための決まり。`roster` の命令は、project の folder の設定に加えて、その**直下の folder** の `.claude/roles/config.jsonc` を集め、1 つに合わせて使う。TPM 担当も、起こした担当も、guard も、合わせた設定を使う。repo ごとの設定は、その repo で直に起こしたときと同じ file がそのまま効く。

```text
ai/                               ← ここで roster start（設定は任意）
├── roster/.claude/roles/config.jsonc     { "tracker": "jira", "infra": { "pagetray": … } }
├── web/.claude/roles/config.jsonc        { "tracker": "github", "skill-sets": ["dependabot"] }
└── notes/                                （設定が無い folder は集めない）
```

集めるのは直下の 1 段だけで、名前の順に読む。`.` で始まる folder と `node_modules` は見ない。project の folder の設定に `folders` を書くと、探さずに書いた folder だけを集める（深い folder も書ける。設定の無い folder を書くと止まる）。直下の folder の設定に書いた `folders` は読まない。直下に設定のある folder が無ければ、project の folder の設定だけが効く。

| 欄 | 合わせ方 |
|---|---|
| `tracker` | 道具ごとに、宣言した設定を覚える（`none` は足さない）。記録を書く先は、課題の Key の形で選ぶ（下の「[課題の Key](#課題の-key)」）。`gh-12` の記録は、`github` を宣言した folder の repo の Issue に書く（`gh` をその folder で打つ）。`github` を宣言した設定が 2 つ以上あると、`gh-` の Key がどの repo の Issue かが決まらないので止まる（`folders` で 1 つに絞る） |
| `infra` | 環境の名前ごとに合わせる。同じ名前がいくつもの設定にあれば、`match` は足し、`guard` は厳しい方（厳しい順に pm-only・pm・tpm・free）にする。どこで打った命令にも効く。`roster infra list` と guard が止めた文に、宣言した設定が出る |
| `skill-sets` | 全部を足す（project の folder が先、次に直下の folder を名前の順。重なりは除く）。TPM 担当（`roster start`）にも、起こす担当にも効く |
| `software-engineer`・`tech-lead`・`devops-engineer`・`staff-engineer`・`auditor` | 合わせない。**担当を起こす folder**（`roster assign --cwd`）の設定 > project の folder の設定 の順に、欄ごとに先に値がある物を使う。Auditor は project の folder で起きるので、project の folder の設定だけ |
| `transport` | project の folder の設定だけ（直下の folder の値は読まない） |
| `messages` | project の folder の設定だけ（直下の folder の値は読まない） |

どの値がどの設定から来たかは、TPM 担当の `roster hello` が出す。上の図の folder で起こすと、次のように出る（直下に設定のある folder が無ければ、`設定: <file>` と `課題管理: …・連携: …` の 2 行。設定の file が無いための値には「（既定）」が付く）。

```text
TPM 担当の宛先: workspace:1
設定（この folder と直下の folder を合わせた物）:
- この folder  /path/to/ai/.claude/roles/config.jsonc（無い）
- roster  課題管理: jira・infra: pagetray
- web  課題管理: github・skill-sets: dependabot
課題管理: Jira の Key（AI-12 の形）→ jira（roster）／gh- の Key → github（web）／t- の Key → 記録しない
連携: cmux（既定）
infra: pagetray（roster）（手続きは roster infra list）
名簿: 担当はいない
```

`roster assign` は、担当を起こした folder（`folder:`）と、`--issue` を付けたときの記録の先（`課題の記録: jira（roster の設定）`）を出す。下の repo をいくつも触る課題の担当は、`--cwd` を付けずに project の folder で起こす（どの repo も、その worktree の置き場も下に入る）。

設定のどれか 1 つでも読めない（JSONC の誤り・欄の誤り）と、`roster` の命令は誤りのある file を名指して止まる。guard も「命令を見られない」として、その project の担当の shell の命令をすべて止める（守りを素通りさせないため）。直下の repo の設定を書き替えたら、`roster start -v <folder>` で読めることを確かめる（読んだ設定の file が `config` の行に並ぶ）。

上の folder で起こした担当には、下の repo の `.claude/settings.json`（hook・権限）は効かない（Claude Code は、起こした folder の settings だけを読む）。

### 課題の Key

| `tracker` | Key の形 | 記録 | 課題を閉じる |
|---|---|---|---|
| `jira` | `AI-12` | コメント（ADF・段落だけ） | 状態を `完了` に進める |
| `github` | `gh-12`（`#12`・`12` も受ける） | コメント（Markdown） | `completed` で閉じる |
| `none` | `t-x7k2`（`roster key` が作る） | 書かない | 何もしない |

記録を書く先は Key の形で決まる: `AI-12` の形は、`jira` を宣言した設定が（project の folder か直下の folder に）1 つでもあれば Jira。`gh-12` の形は、`github` を宣言した設定の folder の repo。宣言した設定が無い道具の Key に `roster assign --issue` を付けると、読んだ設定を並べて止まる。

課題の中身（題・状態・本文・コメント）は、どの担当も `roster issue view <Key>` で読む。読むだけで記録を書かないので、`tracker` によらず Key の形で道具を選ぶ（どの設定も宣言していない道具の Key でも、`AI-12` は acli、`gh-12` は gh で読む。`github` を宣言した設定が無ければ、`gh` は project の folder で打つ）。`roster hello` は、担当の Key が読める形なら `課題の中身: roster issue view <Key>` の行を返す。

`roster assign` は、Key（`--issue` があればそれ）が読める形なら、振るたびに課題を読んで写しのページ（`<Key>/issue-<番号>.html`）を置き、URL を名簿に書いて、担当の `roster hello` と【brief】に `課題の写し: <URL>` として渡す。読めなければ担当を起こさずに止まる。`--no-issue-copy "<訳>"` を付けると写しを作らずに振り、訳を担当に渡す。

新しい担当を起こすとき（交代を含む）、`roster assign` は `--brief` の依頼書（置き場のページでなければ止まる）を読み、課題の概要の節 `<section id="summary">` が無いか、見出しを除いて 40 字に足りなければ、担当を起こさずに止まる。続きの【brief】と、`--brief` 無しで起こす担当（Dependabot の PR・DevOps Engineer 担当）では見ない。

課題管理の課題が無い仕事には、どの `tracker` でも `roster key` が作る `t-` と 4 文字のランダムな英数字の Key を付ける（記録は書かれない）。字は英小文字と数字で、読み違えやすい `0`・`o`・`1`・`l`・`i` は使わない。名簿の担当と、控えの folder にページがある Key（前に使った Key）とはぶつからない。`roster assign` は、名簿に無い `t-` の Key が `t-` と英小文字・数字 4 文字でなければ止める（名簿にある前の決まりの Key は、そのまま使える）。

### 環境の手続き

`guard` には手続き（その環境を変える前に要ること。変えると誰が困るかで決める）を書く。手続きを踏んでいない命令は、guard（`roster guard`）が実行の前に止める（[担当のあいだの決まり](/protocol/#guard)）。

| `guard` | 困る人 | 変えてよい担当 | 先に要ること |
|---|---|---|---|
| `free` | 自分だけ | どの担当も | 無し |
| `tpm` | 並べて動いているほかの担当 | DevOps Engineer 担当だけ | TPM 担当に相談 |
| `pm` | ほかの人・ほかのチーム | DevOps Engineer 担当だけ | Product Manager の承認（TPM 担当が `roster infra approve <環境> --minutes <分>` で承認を書く） |
| `pm-only` | Product Manager が自分の手に取っておく物（起こす・止める・data を消すなど） | どの担当も打てない（TPM 担当・DevOps Engineer 担当・Auditor も。`roster infra run` も止まり、`roster infra approve` も書けない） | Product Manager が自分の terminal で直に打つ。担当は、打ってほしい 1 行を確認のページに書いて `roster ask pm` で送る |

`match` は命令の語で当てる（`cli/src/guard.ts` の `touched`）。命令を単純な命令に分け、項目の頭が旗（`--name db`・`-v db-data*`）なら、その語の並びがどこかに続けて現れれば当たる。頭が旗でない（`aws `・`ssh staging`・`container stop db`）なら、語のどこかに頭の語があり、残りの語がその後に順に現れれば当たる（間に旗や値、`sudo -u root`・`timeout 60` のような前置きが挟まってもよい）。ただし、名を宣言しない環境（`--name`・`--name=`・`-v` の項目の無い環境）の項目は、語が続けて並ぶ時だけ当たる（頭の語の前の前置きのほか、間に挟まってよいのは旗とその値だけ。`container exec x make clean` は `container clean` に当たらない。2026-11-27 t-9tac）。`make lint deploy` のように別の語が挟まる形も止めたいなら、その形の項目を足す。語は丸ごと一致で、末尾が `*` の語だけ前方一致（`db-data*` は `db-data-v1:/data` に当たる。`*` は語の末尾にだけ書ける）。

語で当たらなくても、命令の字全体に項目の字（`*` を除く）が含まれれば止める（`sh -c`・`ssh`・here-document など、字を命令として動かす道は数えきれないので、疑わしければ止める）。字の含みだけの当たりを通すのは、字が命令として動きうる形でない時だけ（2026-11-28 t-y67q。監査 audit-2 の R3 (a)）: どの単純な命令（命令の置き換え `$(…)`・backtick の中も、頭の代入と path を書いたままで見る）も、次の表に当たり、引用しない here-document（`<<EOF`）と命令の置き換えが同じ命令に並ばない時（here-document の中の置き換えは shell が動かす）。手続きに依らず、どの環境も同じ当て方（`pm-only` の環境も）。

| 道具 | 通す形 | 表から外す（字の含みで止める） |
|---|---|---|
| `cat`・`echo`・`printf`・`tee`・`head`・`tail`・`wc`・`sort`・`uniq`・`cut`・`tr`・`diff`・`ls`・`cd`・`pwd`・`mkdir`・`test`・`[`・`true`・`false`・`date`・`jq`・`basename`・`dirname`・`realpath`・`grep`・`rg` | どの旗でも | `sort --compress-program`・`rg --pre`・`rg --pre-glob`（長い旗は頭の 3 字以上の略も） |
| `roster` | どの命令も | `roster infra run` |
| `git` | `commit`・`grep`・`show`・`log`・`diff`・`status`・`rev-parse`・`ls-files`・`blame` | 命令の前の `-c`・`--config-env`・`--exec-path`、`grep` の `-O`（束ねた `-nO…` も）・`--open-files-in-pager`、`--ext-diff`・`--textconv` |
| `gh` | `pr`・`issue`・`release` の本文を送る命令と読む命令、`pr ready`・`pr checks`・`run view`・`run list` | ほかの命令（`alias`・`extension`・`api` など） |
| `pnpm` | `test`・`t`・`run <名>`（前に置いてよい旗は `-C`・`--dir`・`--filter`・`-F`・`-r`・`--recursive`・`-s`・`--silent` だけ） | `exec`・`dlx` と知らない語（script か exec として動く）・ほかの旗 |
| `npx` | 的が `vitest`・`tsc`・`eslint`・`prettier`・`typedoc`（前に置いてよい旗は `--yes`・`-y`・`--no` だけ） | ほかの的とほかの旗（npm の設定はどれも旗で渡せ、`--node-options`・`-c` などが字を動かす） |
| `python`・`python3`・`node` | 命令の字に、命令を起こす呼び出しの字（`subprocess`・`os.system`・`posix_spawn`・`execve`・`child_process`・`execSync`・`exec(`・`system(` など。`cli/src/guard.ts` の `RUN_CALLS`）が無い時 | 呼び出しの字がある時 |

- 頭の代入（`GIT_PAGER=…`・`EDITOR=…`）・前置きの語（`sudo`・`env`・`xargs` など）・path の付いた名は、表に当てない。代入だけの命令（`S=/tmp/x`）と `for x in …` は通す。ただし、代入だけの命令が環境変数を読む道具（`git`・`gh`・`pnpm`・`npx`・`python`・`node`）と同じ命令に並ぶ時（`GIT_EDITOR=…; git commit`。書き出し済みの変数なら子の process に渡る）と、`PATH` への代入は通さない。
- 設定を読む道具（`git`・`pnpm`・`npx`）は、同じ命令に、log（`.log`・`.txt`・`.out`）でない file への書き出し（`>`・`>>`・`>&`・`&>`・`tee`・`sort -o`・`uniq` の 2 つ目の引数・git の `--output`）か `python`・`node` があれば、表から外す（`.git/config`・`.git/hooks`・`package.json` を書いて読ませる形）。
- `sed` は表に入れない（GNU の sed は `e` の命令で字を shell に流し、どちらの sed かを guard は見分けられない）。

だから here-document で file を書く命令・pipe の先の `tail`・python で文を書き替える命令・`roster file put x --name db-x.png | tail` や commit の文に環境の名を書いても止まらない。`RUN_CALLS` は止める側を並べる表なので、並べていない API（言い換えた呼び出し・言語の版で増える API）を使う python・node は通る。言語の版を上げる時に見直す。自ずと動く file（`~/.zshenv`・`.git/hooks`）に書く命令も通る（次の命令から動く。Write の道具では前から通る）。広すぎると読むだけの命令も止まり、狭すぎるとすり抜けるので、その環境を変える命令の頭を書く。名の一部で当てていた項目（`ssh staging` が `ssh staging-01` に当たるなど）は、語で当てると当たらず、字の含みで止まる（`ssh` は通す命令に無いので、今は止まる）。前方一致で当てたい語には `*` を付ける（2026-11-27 t-7j37 で、語で当てる形に替えた。台帳 #253）。

名を書かずに的を選ぶ命令も当てる（2026-11-27 t-9tac）。環境の名は、名を宣言する項目（`--name db`・`--name=db`・`-v db-data*`）から引き、終わりの語がその名の項目（`container stop db`・`container volume rm db-data*`）の、名の前の語を動詞（`container stop`）と読む。命令の中に動詞の語が続けて並び（間に挟まってよいのは旗とその値だけ）、その後ろの的（旗と `-s`・`-t` などの値を除いた語）が、無い（xargs で渡す・`-a` だけ）か、字で書いた名（英数字・`_`・`.`・`-`）でない語（`$(…)`・変数・glob・`{}`・`%`）を含むか、`--all` があれば、その環境に触るとみなす（`container stop --all`・`container rm -f $(container ls -q)`・`… | xargs container rm`）。名を宣言しない環境と、終わりの語が名でない項目（`container builder stop`）からは動詞を引かないので、`container volume inspect $V` のような読むだけの命令は止まらない。名を取らない命令（`container system stop`・`container prune`・`container volume prune`）は、項目に書いて当てる（roster の設定の `container-system`）。

container の命令（語のどこかの名が `container` の単純な命令）は、旗の書き方をそろえてから当てる（2026-11-27 t-ta2b。台帳 #300）。その語より後ろの旗と、項目の語を、同じ形にそろえる: 長い旗の `=` を割る（`--name=db` → `--name db`）・`--volume` を `-v` に・`-v=x`・`-vx`・束ねた `-dv x`・`-dvx` を `-v x` に・`--mount` の `source=`（`src=`）の値を `-v` の値に（source の無い字の `--mount type=tmpfs,…` は `-v` にしない）。`--` より後ろと `container exec` の後ろ（container の中で動かす命令の語）はそろえない。`container run` の image より後ろの語（container の中の命令）は、image の位置が値を取る旗を知らないと決まらないので、そろえて読む（`container run img tar -xzv db-data-v1.tgz` は止まる。`--` を挟めばそろえない）。だから項目は `--name db`・`-v db-data*` の形で書けば、`--name=db`・`--volume=db-data-v1:/data`・`--mount type=volume,source=db-data-v1,target=/data` にも当たる（`--name=db`・`--volume db-data*` の項目を並べなくてよい）。字の含みの当たりでも、`--name db` の項目は `--name=db` の字を、`-v db-data*` の項目は `--volume db-data` の字も見るので、container の語の無い包み（`./up.sh --name=db`）も、その項目で止まる（2026-11-28 t-d37r。前は `--name=db`・`--volume db-data*` の項目を並べて当てていた）。container の命令でない語はそろえないので、`grep -- "--name=db"` は `--name=db` の項目にも当たらない（`grep` は字の含みでも当てない）。字の含みの当たりでも、命令の字を `;`・`&`・`|`・括弧・改行の区切りに分けて粗く語に割り、区切りごとに container の命令の旗をそろえて、頭が旗の項目と比べる（`container logs x | grep -v "$X"` の grep の旗は読まない。`\` と改行で続けた行は 1 つの命令に戻してから分ける。どの単純な命令も字を動かさない物（通す命令のほか `cat`・`echo`・`printf` と、本文を送るだけの `gh pr create|comment|edit|review`・`gh issue create|comment|edit`・`gh release create|edit`）なら、この当たりは外す。だから PR の本文や `git commit -F - <<'EOF'` の文に container の命令の字を書いても止まらない。`cat <<X | sh` と、引用しない here-document（`<<EOF`。中の `$(…)` を shell が動かす）に置き換えがある時は読む）（here-document や `ssh host '…'` の中の `--volume=db-data-v1` も止まる）。

container の命令の `--name`・`-v` の値に、変数（`$N`・`${N}`）・命令の置き換え（`$(…)`・backtick。語の途中の `"$(cat f)":/data` も）・glob の字（`*`・`?`）・xargs と find の置き場（`{}`・`%`）・brace の展開（`{a,b}`）があるか、旗が語の終わりで値が無ければ（`… | xargs container run --name`）、その所を何でも当たるとみなして項目の値と比べる（`--name "$N"`・`-v "$V":/data` は、名か volume を宣言した環境にみな当たる。`--name "test-$N"` は `db` に当たらない）。同じ行の代入（`N=db; …`）と環境変数は読まない（代入が効くかは shell の形で変わり、guard の process の環境変数は Bash の命令の shell の物と違うため）。`$HOME`・`$PWD`・`$OLDPWD`・`$TMPDIR` は、後ろが `/`・`:`・語の終わりの時は path と読むので、`-v "$PWD:/w"` は当たらない（`${TMPDIR}db-data-v1` のように字が続く時は、空でありうるので読まない。命令の字に、その名が `$` の後ろ以外で出る時（`HOME=x`・`export HOME`）は、同じ行で替えうるので path と読まない）。止める・消す動詞の的も、語の途中の置き換え（`container stop x$(echo y)`）を名を書かない的とみなす。

環境の container・volume の名を的にする container の命令は、宣言に無い動詞でも止める（2026-11-28 t-d37r。台帳 #312）。名は、名を宣言する項目（`--name db`・`-v db-data*`）から引く。読むだけの動詞（`logs`・`inspect`・`stats`・`list`（`ls`）と、volume の `inspect`・`ls`）と、名の container を的にしない動詞と群（`run`・`create`（名と volume は `--name`・`-v` の項目が当て、image より後ろは container の中の命令の語）・`image`（`i`）・`registry`（`r`）・`machine`（`m`）・`network`（`n`）・`system`（`s`）・`cluster`・`build`・`builder`・`help`）のほかは、`exec`・`cp`・`commit`・`export` も、宣言にある `stop`・`rm` なども、container の版が上がって足された知らない動詞も当てる（疑わしければ止める）。的は、`exec` は旗と旗の直後の語を読み進め、旗の直後でない初めの語までを候補にする（値を取る旗を数えないので、`-iu root db` の `db` も見落とさない。後ろは container の中の命令なので見ない。`container exec mytest grep db /etc/hosts` は通る）、`cp`（`copy`）は `:` を含む語の `:` より前（`db:/data/x` の `db`。`:` の無い値の分からない語も）、ほかは旗と `-s`・`-t`・`-o` などの値を除いたどの語も（`--` の後ろはみな）。知っている container の動詞の的は container の名と、volume の群（`container volume …`・`container v …`。次の語を動詞と読む）の的は volume の名と、知らない動詞の的は両方と比べる。的が値の分からない語（`"$N"`・`$(…)`・`{}`）・的が無い（`xargs container exec`。知っている動詞だけ）・`--all` の時も、名を宣言した環境にみな当たるとみなす（自分の container は名を字で書けば通る）。`-h`・`--help` は通す（`exec` は exec 自身の旗だけ。`container exec db ls --help` の `--help` は container の中の命令の旗なので止まる）。字を動かさない命令（`grep`・`rg`・`git commit`・`cat`・`echo`・`printf`・`roster`）の引数の `container` の語は container の命令と読まず、知らない動詞は的の語が無ければ当てないので、`grep -n container docs`・`git grep container`・`find . -name container` は通る。`ssh host '…'`・here-document の中は、字で書いた名だけを当てる（`ssh host 'container stop -t 5 db'` も止まる）。だから宣言に `container exec db` や `container rm -f db` のような項目を並べなくてよい（`container stop db` などの項目は、名を書かずに選ぶ命令の動詞を引くのにも使う）。

## model などの既定の環境変数（任意）

shell の profile などで書くと、すべての project・すべての担当（TPM 担当を含む）の model・effort・permissionMode の既定になる。

| 環境変数 | 決める物 | 例 |
|---|---|---|
| `ROSTER_MODEL` | `--model` | `claude-fable-5-2` |
| `ROSTER_EFFORT` | `--effort` | `high` |
| `ROSTER_PERMISSION_MODE` | `--permission-mode` | `bypassPermissions` |

欄ごとに、次の順で先に値がある物を使う（空の字は書かなかったものとみなす）。

| 順 | どこ | 効く担当 |
|---|---|---|
| 1 | 命令の旗（`roster assign --model` など。Sustaining Engineer 担当は `.claude/dependabot/config.jsonc` に書いた欄を `/dependabot-triage` が旗にする） | その 1 回 |
| 2 | `.claude/roles/config.jsonc` の担当の欄 | Software Engineer・Tech Lead・DevOps Engineer・Staff Engineer・Auditor |
| 3 | 環境変数 `ROSTER_MODEL`・`ROSTER_EFFORT`・`ROSTER_PERMISSION_MODE` | すべて（TPM 担当を含む） |
| 4 | コードの既定（TPM 担当・Software Engineer 担当・Tech Lead 担当・Sustaining Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、Staff Engineer 担当は Opus 5.5・high、Auditor は Fable 5.2・high、どれも `bypassPermissions`） | すべて |

```sh
# ~/.zshrc など
export ROSTER_MODEL=claude-fable-5-2
export ROSTER_EFFORT=medium
```

- model は、どこに書いても `claude-` で始まる id（`claude-opus-5-5` など）にする。`opus`・`sonnet`・`haiku`・`opus[1m]` などの別名は、`roster start`・`roster assign`・`roster audit start`・`roster hello` が、どこから来た値か（`--model`・`config.jsonc の <役割>.model`・`$ROSTER_MODEL`）を添えて断る（起こした model を castlist に残す時、別名では何の model か決まらないため）。
- `roster start` は環境変数を読んで 1 行の `--model`・`--effort`・`--permission-mode` に入れる。TPM 担当が名乗る `roster hello` も同じ値を状態の `model` に出す（effort は、Claude Code が入れる `$CLAUDE_EFFORT` があればそれ）。
- `roster start` は、書いてある環境変数を 1 行の頭（`PATH=…` の隣）にも写す。`roster assign` は TPM 担当の居場所で動き、TPM 担当の Claude Code の環境変数を読むので、profile で export した値も、`ROSTER_MODEL=… roster start` のように 1 行を出すときだけ付けた値も、TPM 担当と担当の両方に効く。

## ページの置き場の環境変数（任意）

`roster page put`・`roster page path`・`roster page list`・`roster page import`・`roster page delete` と `roster file put`・`roster file path`・`roster file list`・`roster file delete` が使う、置き場（[担当のあいだの決まり](/protocol/#ページの置き場)）の URL と、控えの folder。置き場は roster を動かす機械に 1 つで、project をまたいで同じなので、`.claude/roles/config.jsonc` には書かない。替えるのは、置き場の container の port を替えたときだけ。

| 環境変数 | 決める物 | 無いとき |
|---|---|---|
| `ROSTER_PAGES_DIR` | 控えの folder（置いた・読んだページと file を roster を動かす機械に写す所。前の置き場の folder と同じ） | `$XDG_DATA_HOME/roster/pages`（`$XDG_DATA_HOME` も無ければ `~/.local/share/roster/pages`） |
| `ROSTER_PAGES_URL` | 置き場の URL（container の port の publish と同じにする） | `http://127.0.0.1:8801` |

- `roster` は置き場に、pagetray 1.0.0 からの API（`/api/…`）で頼む。頼むのは、定義から生成した client（[開発](/development/#生成した-clientcastlistpagetray-の定義から)）。ページの本文と file の中身だけは URL の手の道なので、curl で取る（`roster page path`・`roster file path`・取り込みの見比べ）。
- 置き場が応えなければ、頼む物の答えで「置き場が応えません」と出る。呼ぶ操作を持たない古い版の置き場（`NotFound` でない 404。`UnknownOperationException` か誤りの型の無い 404）なら「置き場が、この roster の呼ぶ操作を持たない」と出る（[運用](/operations/#版を上げる)）。
- 頼む物はどれも 1 度だけ送り（送り直さない）、10 秒まで待つ。`AWS_MAX_ATTEMPTS` などの `AWS_*` の環境変数と `~/.aws/config` は読まない。

## アクターの台帳（castlist）（任意）

アクターの台帳（別の repo の [castlist](https://uraitakahito.github.io/castlist/)）は、Claude Code の session 1 つ（TPM 担当・担当・Auditor）と人の Product Manager を、それぞれアクターとして残す、roster を動かす機械の中だけのサーバー。誰が誰を起こしたか・どの model と effort で動いたかを、Auditor が後から引く。`roster` が何をいつ送るかは [担当のあいだの決まり](/protocol/#アクターの台帳castlist)。

- project の folder の `.claude/roles/config.jsonc` に `"castlist": "http://127.0.0.1:8802"` を書くと、`roster` が castlist に送る。直下の folder の設定に書いた値は読まない（連携と同じ）。
- 書かなければ、`roster` は castlist に何も送らない。`roster start`（stderr。terminal で `NO_COLOR` が無ければ赤の太字）と `roster hello`（出力の頭）が、枠で囲んだ警告を出す（止めない。直下の folder の設定にだけ書いた時は、読まないことも書く）。警告を消す書き方は無い。hook の命令（`roster castlist session-start`・`roster castlist session-end`）はどの席にも付くが、何もしない。メッセージの受け手の名に入る起こしの id は、castlist を設定した時だけ名簿に書かれるので、設定していない project では、同じ Key で起こし直した担当が、前の担当宛てで残っていた物を受け取る（Key が違う担当には届かない。[担当のあいだの決まり](/protocol/#届け違い)）。castlist を読む命令（`roster castlist find` など。[担当のあいだの決まり](/protocol/#監査の検索を読む)）は、設定していないと言う 1 行で止まり、`roster incident timeline` はアクターの欄を出さない。
- 環境変数 `ROSTER_CASTLIST_URL` があれば、設定の値より先に使う（試験と、port を替えた時のため）。

| 環境変数 | 決める物 | 無いとき |
|---|---|---|
| `ROSTER_CASTLIST_URL` | castlist の URL（`http://127.0.0.1:<port>` か `http://localhost:<port>`） | 設定の `castlist`。それも無ければ、castlist に何も送らない |
| `ROSTER_CALLBOARD_URL` | 画面のサーバー（callboard）の URL（同じ形）。`roster castlist …` と `roster incident timeline` が出す、アクターのプロフィールの画面の URL の頭になる（roster は callboard に何も送らない） | `http://127.0.0.1:8803` |

- `roster` は castlist に、castlist 1.0.0 からの API（`/api/…`）で送る。送るのは、定義から生成した client（[開発](/development/#生成した-clientcastlistpagetray-の定義から)）。
- 起こす前（`roster start`・`roster assign`・`roster audit start`・`roster hello`）に `/healthz` を見て、castlist が応えなければ起こさずに止まる（[運用](/operations/#アクターの台帳castlist)）。
- 送る物はどれも 1 度だけ送り（送り直さない）、書く要求と監査の検索は 6 秒まで、`/healthz` は 1 秒まで待つ。`AWS_MAX_ATTEMPTS` などの `AWS_*` の環境変数と `~/.aws/config` は読まない。
- 前の版の設定の欄 `api`（生成した client で送るかの選び）は、もう無い。残っていても、どんな値でも読み飛ばす（消してよい）。

## メッセージを配る道

担当どうしのメッセージは、いつも NATS JetStream（[運用](/operations/#メッセージキューnats)）で配る。連携の道具（cmux）は、メッセージを運ばない。project ごとに選ぶ所は無い（roster を使う project では、NATS が動いていること）。

- `.claude/roles/config.jsonc` の `messages` に書けるのは `"nats"` だけで、書いても書かなくても同じ。前の版の `"cmux"` が残っていると、設定の誤りで止まり、その行を消すよう言う。
- `roster start` の 1 行と `roster assign` は、起こす claude に、メッセージを渡す hook（`roster mail …`）をいつも付ける。前の版で起こした、hook を持たない席宛ての物も NATS に置かれ、その席の `roster inbox` と送る前の検査が、命令の結果に本文を出す。
- 届き方・送る前の検査・状態の folder の file は、[担当のあいだの決まり](/protocol/#メッセージを-nats-で配る道)。確かめ方と戻し方は、[運用](/operations/#届くことを確かめる戻す)。

| 環境変数 | 決める物 | 無いとき |
|---|---|---|
| `ROSTER_NATS_URL` | NATS の URL（container の port の publish と同じにする） | `nats://127.0.0.1:4222` |

## 通知のバナー（任意）

画面の右上に出る通知のバナーは、cmux が居場所の Claude Code の通知（答え終わった・入力待ちの催促・許可/質問）のたびに出す。担当の居場所のバナーまで出ると、Product Manager が見る物が多すぎるので、`roster banner hook` を cmux の通知の hook に置き、居場所の役割 × きっかけで出すか消すかを選ぶ。消した通知も、cmux の通知の一覧と未読の印には残る。roster の名簿に無い居場所（roster の外の Claude Code）は cmux のまま。

### cmux.json に hook を足す

```sh
roster banner setup   # ~/.config/cmux/cmux.json に足す 1 行と手順を出す
roster banner check   # 設定と hook を確かめる
```

`roster banner setup` が出す欄を、`~/.config/cmux/cmux.json` の `notifications.hooks` に Product Manager が足す（roster は cmux.json を書き替えない）。hook は cmux の app から動き、shell の PATH を受け継がない（PATH は macOS の既定の `/usr/bin:/bin:/usr/sbin:/sbin` だけ）。そのため `cli/bin/roster` は、PATH に `node` が無ければ nodenv の shim（`${NODENV_ROOT:-~/.nodenv}/shims`）を、`cmux` が無ければ cmux の app の中の folder を自分で足す。命令は入口を呼ぶだけで、Node と cmux の path を書かないので、Node を上げても替えなくてよい。repo を移したときは打ち直す（[運用](/operations/#移す手順)）。

```sh
[ -x "$HOME/…/cli/bin/roster" ] || { echo '{}'; exit 0; }; exec "$HOME/…/cli/bin/roster" banner hook
```

命令の頭の検査は、入口が無い機械（roster を入れていない機械）で、何も替えずに（`{}` を返して）0 で終わるための物。dotfiles などで同じ cmux.json をいくつもの機械に配っても、roster の無い機械で通知のたびに失敗しない（バナーは cmux のまま出る）。入口が有って動けない時（node が見つからない・roster が落ちる）は、cmux はいつものバナーに加えて「Notification Hook Failed」を出す（黙ってバナーが消えはしない）。古い形の命令（頭に `PATH=…` を書いた物・入口の検査が無い物）が残っていると、`roster banner check` と TPM 担当の `roster hello` が知らせる。

### `~/.config/roster/banner.jsonc`（任意）

何を出すかの設定。`$XDG_CONFIG_HOME` があれば `$XDG_CONFIG_HOME/roster/banner.jsonc`。バナーを見るのは project でなく人なので、`.claude/roles/config.jsonc` には書かない。無ければ次の既定と同じ。

古い名の頃の在り処 `~/.config/tpm/banner.jsonc` は読まない。そこに file が有れば、`roster banner check` と TPM 担当の `roster hello` が、移す命令を添えて知らせる（新しい在り処にも有れば、古い方は消してよいと知らせる）。

```jsonc
{
  // 役割: tpm・software-engineer・tech-lead・devops-engineer・staff-engineer・sustaining-engineer・auditor と、ほかをまとめる "*"
  // きっかけ: turn（答え終わった）・idle（入力待ちの催促）・ask（許可/質問）
  // 値: "show"（出す）・"hide"（消す）・"pm-wait"（その回に roster wait pm を打った時だけ出す）
  "banner": {
    "tpm": { "turn": "pm-wait", "idle": "hide", "ask": "show" },
    "auditor": { "turn": "pm-wait", "idle": "hide", "ask": "show" },
    "*": { "turn": "hide", "idle": "hide", "ask": "show" },
  },
  // バナーを消す時に一緒に消す物: sound・paneFlash・reorderWorkspace
  "withBanner": ["sound"],
}
```

- 役割の欄は、書いたきっかけだけを上書きする（`"devops-engineer": { "turn": "show" }` なら、DevOps Engineer 担当の答え終わったも出す）。
- 役割の名は `cli/src/protocol.ts` の `ROLES` の名と tpm（TPM 担当）。ここに無い名を書くと、hook は設定を読めないとして止まる（`/dependabot-triage` は TPM 担当が呼ぶ skill で、役割ではない）。
- `pm-wait` は「前に答え終わった時より後に `roster wait pm` を打った」回だけ出す。TPM 担当は手が空くと `回答待ち(PM): 指示` のまま待つので、状態の字だけでは、担当のメッセージをひとりで片付けた回まで鳴ってしまうため。TPM 担当は Product Manager に返して手を止める前に `roster wait pm` を打つ。
- 設定を読めない間、hook はバナーを消さず、記録に訳を書く。`roster banner check` が誤りを出す。
- hook が決めたことは、project の状態の folder の `banner.jsonl` に 1 行ずつ書く（7 日で消す）。`roster banner log` が新しい順に出す。
- すべての居場所でまとめて止めたいだけなら、cmux の設定（`notifications.agentTurnComplete`・`agentIdleReminder`・`agentPermissionPrompt`）でもできる。cmux を前にしている間のバナーをすべて消す `notifications.suppressWhenAppFocused` は、残したバナー（Product Manager を待つ・許可/質問）まで消すので勧めない。

## Dependabot の設定

Dependabot の skill を使う project では、`.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` を書き、次の 2 つを置く。`/tpm` の起動では Dependabot の PR を見ない。Product Manager が言ったときに TPM 担当が `/dependabot-triage` を呼ぶ。skill セットを書かなければ `/dependabot-triage` は使えない。skill セットを書いても 2 つが無いと `/dependabot-triage` と `/sustaining-engineer` は止まる。

### `.claude/dependabot/config.jsonc`

`/dependabot-triage`・`dependabot-scan`（`/dependabot-triage` が PR の表を作らせる助手の skill）・`/sustaining-engineer` はこの表を読み、欄を `config.<欄>` と書く（表と skill の欄の揃いは `docs-site/scripts/check-refs.mjs` が見る）。`.claude/roles/config.jsonc` と同じく JSONC で書く。古い名前の `config.json` があれば、skill は読まずに止まる（扱いは `.claude/roles/config.json` と同じ）。

| 欄 | 中身 | 例 |
|---|---|---|
| `owner` | GitHub の owner | `"example-org"` |
| `repos` | 対象の repo の名前の配列（fork などは入れない） | `["app", "lib"]` |
| `cwd` | Sustaining Engineer 担当を起こす folder（無ければ使う側の project の folder） | `"/path/to/workspace"` |
| `maxConcurrent` | 同時に動かす Sustaining Engineer 担当の数 | `3` |
| `hours` | 依存の version の公開から何時間たったら merge を検討するか | `72` |
| `model` | Sustaining Engineer 担当の model（無ければ `ROSTER_MODEL`、それも無ければ既定） | `"claude-opus-5-5"` |
| `effort` | Sustaining Engineer 担当の effort（無ければ `ROSTER_EFFORT`、それも無ければ既定） | `"medium"` |
| `permissionMode` | Sustaining Engineer 担当の `--permission-mode`（無ければ `ROSTER_PERMISSION_MODE`、それも無ければ既定） | `"bypassPermissions"` |
| `mergeMethod` | `gh pr merge` の方法 | `"squash"` |
| `rebaseWaitMinutes` | `@dependabot rebase` の応じた印 👍 を待つ分 | `20` |

### `.claude/dependabot/rules.md`

その project の決まりを文で書く。skill はこれを手順より先に読み、従う。例: 読むべき memory や教訓・worktree を置く場所・共有の環境を変える操作を誰に頼むか・audit の赤を除外している勧告と課題の番号・使ってはいけない語。
