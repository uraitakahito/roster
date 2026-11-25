---
title: 設定
description: 使う側の project に置く .claude/roles/config.jsonc（課題管理・連携・インフラの環境・担当の既定・アクターの台帳・生成した client への切り替え。直下の folder の設定も合わせる）、model などの既定を人ごとに決める環境変数、ページの置き場の環境変数、Dependabot の skill の設定
---

## `.claude/roles/config.jsonc`（任意）

TPM 担当を起こした folder（project）に置くと、道具の選び方・追加の skill セット・起こす担当の既定を替えられる。`roster` の命令が読む。project の直下の folder にも設定があれば、集めて 1 つに合わせる（下の「[直下の folder の設定](#直下の-folder-の設定)」）。JSONC（`//`・`/* */` のコメントと、`}`・`]` の前の末尾のカンマを許す JSON）で書く。

古い名前の `.claude/roles/config.json` があると、`roster` の命令はそれを読まずに止まる。`config.jsonc` が無ければ名前を替える `mv` を出す（中身はそのまま JSONC として読めるので、名前を替えるだけで移せる）。両方あれば、`config.json` を消すよう言う（要る中身は先に `config.jsonc` へ移す）。

| 欄 | 中身 | 無いとき |
|---|---|---|
| `tracker` | 課題管理の道具。`jira`（acli）・`github`（その folder の repo の Issue。gh）・`none` | `none`（課題に記録を書かない） |
| `transport` | 担当どうしの連携の道具。`cmux`（`file` は試験用） | `cmux` |
| `infra` | インフラの環境の宣言。環境の名前（英小文字・数字・`-`）ごとに `guard`（手続き）と `match`（その環境に触る命令が含む字の配列） | 宣言なし（guard は環境を見ない） |
| `skill-sets` | core のほかに加える、追加の skill セットの名前の配列 | core だけ |
| `folders` | 設定を集める folder（project の folder からの path）の配列。書くと、直下を探さずに書いた folder だけを集める。`[]` なら集めない | 直下の folder のうち、設定がある物を全部集める |
| `castlist` | アクターの台帳（castlist）の URL（`http://127.0.0.1:<port>` か `http://localhost:<port>`）。project の folder の設定だけが効く（下の「[アクターの台帳（castlist）](#アクターの台帳castlist任意)」） | castlist に何も送らない |
| `api` | server ごとに、生成した client（新しい API）で送るか。`{ "castlist": "next", "pagetray": "next" }` の形で、書いた server だけを替える。project の folder の設定だけが効く（下の「[生成した client への切り替え](#生成した-client-への切り替え任意)」） | どの server も今の client（curl） |
| `software-engineer`・`devops-engineer`・`staff-engineer`・`auditor` | 起こす担当の `model`・`effort`・`permissionMode` | [環境変数](#model-などの既定の環境変数任意)、それも無ければ既定（Software Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、Staff Engineer 担当は Opus 5.5・high、Auditor は Fable 5.2・high、どれも `bypassPermissions`） |

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
| `infra` | 環境の名前ごとに合わせる。同じ名前がいくつもの設定にあれば、`match` は足し、`guard` は厳しい方（`pm-only` > `pm` > `roster` > `free`）にする。どこで打った命令にも効く。`roster infra list` と guard が止めた文に、宣言した設定が出る |
| `skill-sets` | 全部を足す（project の folder が先、次に直下の folder を名前の順。重なりは除く）。TPM 担当（`roster start`）にも、起こす担当にも効く |
| `software-engineer`・`devops-engineer`・`staff-engineer`・`auditor` | 合わせない。**担当を起こす folder**（`roster assign --cwd`）の設定 > project の folder の設定 の順に、欄ごとに先に値がある物を使う。Auditor は project の folder で起きるので、project の folder の設定だけ |
| `transport` | project の folder の設定だけ（直下の folder の値は読まない） |

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
| `roster` | 並べて動いているほかの担当 | DevOps Engineer 担当だけ | TPM 担当に相談 |
| `pm` | ほかの人・ほかのチーム | DevOps Engineer 担当だけ | Product Manager の承認（TPM 担当が `roster infra approve <環境> --minutes <分>` で承認を書く） |
| `pm-only` | Product Manager が自分の手に取っておく物（起こす・止める・data を消すなど） | どの担当も打てない（TPM 担当・DevOps Engineer 担当・Auditor も。`roster infra run` も止まり、`roster infra approve` も書けない） | Product Manager が自分の terminal で直に打つ。担当は、打ってほしい 1 行を確認のページに書いて `roster ask pm` で送る |

`match` は命令の字との一致で見る。広すぎると読むだけの命令も止まり、狭すぎるとすり抜けるので、その環境を変える命令の頭（`aws `・`ssh staging` など）を書く。

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
| 2 | `.claude/roles/config.jsonc` の担当の欄 | Software Engineer・DevOps Engineer・Staff Engineer・Auditor |
| 3 | 環境変数 `ROSTER_MODEL`・`ROSTER_EFFORT`・`ROSTER_PERMISSION_MODE` | すべて（TPM 担当を含む） |
| 4 | コードの既定（TPM 担当・Software Engineer 担当・Sustaining Engineer 担当は Opus 5.5・medium、DevOps Engineer 担当は Opus 5.5・low、Staff Engineer 担当は Opus 5.5・high、Auditor は Fable 5.2・high、どれも `bypassPermissions`） | すべて |

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

## アクターの台帳（castlist）（任意）

アクターの台帳（別の repo の [castlist](https://uraitakahito.github.io/castlist/)）は、Claude Code の session 1 つ（TPM 担当・担当・Auditor）と人の Product Manager を、それぞれアクターとして残す、roster を動かす機械の中だけのサーバー。誰が誰を起こしたか・どの model と effort で動いたかを、Auditor が後から引く。`roster` が何をいつ送るかは [担当のあいだの決まり](/protocol/#アクターの台帳castlist)。

- project の folder の `.claude/roles/config.jsonc` に `"castlist": "http://127.0.0.1:8802"` を書くと、`roster` が castlist に送る。直下の folder の設定に書いた値は読まない（連携と同じ）。
- 書かなければ、`roster` は castlist に何も送らない。`roster start`（stderr。terminal で `NO_COLOR` が無ければ赤の太字）と `roster hello`（出力の頭）が、枠で囲んだ警告を出す（止めない。直下の folder の設定にだけ書いた時は、読まないことも書く）。警告を消す書き方は無い。hook の命令（`roster castlist session-start`・`roster castlist session-end`）はどの席にも付くが、何もしない。届け違いの hook（`roster returned check`）は castlist に依らずに動くが、担当の起こしの id は castlist を設定した時だけ名簿に書かれるので、同じ Key で起こし直した担当への届け違いは見分けない（Key が違う物は見分ける。[担当のあいだの決まり](/protocol/#届け違い)）。castlist を読む命令（`roster castlist find` など。[担当のあいだの決まり](/protocol/#監査の検索を読む)）は、設定していないと言う 1 行で止まり、`roster incident timeline` はアクターの欄を出さない。
- 環境変数 `ROSTER_CASTLIST_URL` があれば、設定の値より先に使う（試験と、port を替えた時のため）。

| 環境変数 | 決める物 | 無いとき |
|---|---|---|
| `ROSTER_CASTLIST_URL` | castlist の URL（`http://127.0.0.1:<port>` か `http://localhost:<port>`） | 設定の `castlist`。それも無ければ、castlist に何も送らない |

## 生成した client への切り替え（任意）

castlist と pagetray の作り直し（AI-36）の間だけの欄。`api` に server の名と `next` を書くと、`roster` はその server に、定義から生成した client（[開発](/development/#生成した-clientcastlistpagetray-の定義から)）で新しい API（`/api/…`）に送る。書かない server は今の client（curl で今の API）のまま。新しい server に替えた時に書き、切り替えが済んだら、今の client と共にこの欄を消す。

```jsonc
{
  "castlist": "http://127.0.0.1:8802",
  // castlist に書く物を、新しい API で送る
  "api": { "castlist": "next" },
}
```

- `castlist`: 書く物（session の登録・出来事・線・model と effort・Product Manager の登録）を、新しい API で送る。読む物（起きているかの `/healthz`・監査の検索）は、まだ今の client で送る。答えの見方（止まっている・混んでいる・断られた）は今の client と同じ。
- `pagetray`: 書けるが、まだ何も替えない（置き場の client を替えるのは、この後の PR）。
- 生成した client も、今の curl と同じに 1 度だけ送り（送り直さない）、castlist に書く要求は 6 秒まで待つ。`AWS_MAX_ATTEMPTS` などの `AWS_*` の環境変数と `~/.aws/config` は読まない。
- 値は `next` だけ。今の client にするなら、その server の欄を書かない。知らない server の名と `next` でない値は、設定の誤りで止まる。直下の folder の設定に書いた値は読まない（`castlist` と同じ）。

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
  // 役割: tpm・software-engineer・devops-engineer・staff-engineer・sustaining-engineer・auditor と、ほかをまとめる "*"
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
