---
title: skill
description: skill セット（--add-dir の先）と、skill ごとの起こす人・担当・すること
---

## `--add-dir` の先の skill セット

skill は skill セットに分けてあり、`--add-dir` で足した skill セットの skill だけが使える。

| skill セット | 入るとき | skill |
|---|---|---|
| core | いつも（`roster start` の 1 行と、担当を起こす `roster assign`・`roster audit start` が `--add-dir` で渡す） | `/tpm`・`/software-engineer`・`/tech-lead`・`/devops-engineer`・`/staff-engineer`・`/audit`・`audit-evidence`・`figure-fix`・`_shared/protocol.md`・`_shared/audit-charter.md`・`_shared/audit.md`・`_shared/figures.md` |
| dependabot | 起こす folder の `.claude/roles/config.jsonc` の `skill-sets` に `"dependabot"` と書いたとき（[設定](/configuration/)）。`roster assign` は、設定に書いた skill セットを起こす担当にも渡す | `/dependabot-triage`・`dependabot-scan`・`/sustaining-engineer` |

skill セット `<名前>` の skill は `skill-sets/<名前>/.claude/skills/` に置く。skill セットは `skill-sets/` の下に兄弟の folder で置く（入れ子にすると、外側の skill セットを足したセッションが内側の skill セットの folder を触ったときに、内側の skill まで見つかりうるため）。

## 手伝いの定義（`.claude/agents/`）

skill セットの `.claude/agents/<名>.md` は、手伝い（subagent。Agent tool と `context: fork` の skill が起こす）の定義。core の物は、どの席にも `--add-dir` で渡る。Claude Code は `--add-dir` の先の定義も読み、同じ名なら組み込みの手伝いより勝つ（Claude Code の文書には書かれていない。2.1.332 の中と手元の試しで確かめた。2026-11-28 t-cjj4）。

| 定義 | model | 何のため |
|---|---|---|
| `Explore` | `haiku` | 組み込みの `Explore` を置き換える。組み込みは親の model を受け継ぎ（Opus より上の model の下では Opus に止める）、担当の読むだけの探しが Opus で動いていた（7 日で $98.96）。探しは軽い仕事なので Haiku で動かす（入れる前に、記録の頼み 10 本を Opus と Haiku で比べた） |
| `audit-reader` | `opus` | `audit-evidence` だけが使う、読むだけの手伝い。監査の証拠の字をそのまま写す仕事を、`Explore` の Haiku に替えずに今までどおり Opus で動かす |

- 定義し直すと、組み込みの道具の止めは引き継がれない。読むだけの 2 つは、Claude Code 2.1.332 の Agent tool の説明の `Explore` の行（「All tools except …」）から写した 9 つ（`Agent`・`Artifact`・`ArtifactComments`・`ArtifactData`・`ArtifactCheck`・`ExitPlanMode`・`Edit`・`Write`・`NotebookEdit`）を `disallowedTools` に書く。roster の guard は Artifact を見ないので、ここで止める。MCP の道具（課題管理や文書の書き込みなど）は止めていない（組み込みの `Explore` と同じ。guard も MCP を見ない）。版が上がると組み込みの並べが増えうるので、版上げの時に見直す（`check-skills.mjs` の `READ_ONLY_DENIED`）。
- `omitClaudeMd: true` は、組み込みの `Explore` と同じく CLAUDE.md を読ませない欄（文書に無く、版の中にだけある）。
- 効くのは、定義を merge して roster の本体の checkout を pull した後に起こした席から。動いている席は、起こし直すまで前の定義のまま。
- Claude Code の版を上げた時は、`--add-dir` の先の定義がまだ読まれるかを確かめる（文書に無い振る舞いなので、黙って読まれなくなりうる。その時は組み込みの `Explore`（Opus）に戻る）。手伝いの写しの `*.meta.json` の `model` が `claude-haiku-5-5` なら効いている。
- 戻す時は `Explore.md` を消す。

## skill

| skill | 起こす人 | 担当者 | すること |
|---|---|---|---|
| `/tpm` | Product Manager（`roster start` が出す 1 行を打つ。`/tpm` はその 1 行の最初の入力） | TPM | Product Manager を助け、課題ごとに担当者を割り当てる |
| `/software-engineer` | TPM（`roster assign <Key> --role software-engineer`）。分けた課題では Tech Lead 担当（`roster seat add <名>`。repo の席） | Software Engineer | 課題 1 つを受け持つ。`roster hello` で依頼書の URL を受け取り、調査・提案・計画・実装・テストを worktree で進め、成果をページ（置き場の HTML）と PR で出す。TPM 担当が【dismiss】を送るまで、同じ課題の続きを同じ担当が受ける |
| `/tech-lead` | TPM（`roster assign <Key> --role tech-lead`） | Tech Lead | いくつもの repo に渡る課題 1 つの全体をまとめる。計画（並べられる仕事の組・分けるかの見立て・席の数）と repo の境の取り決めを書き、repo ごとの席（Software Engineer 担当）を `roster seat add` で起こして依頼書を渡し、その計画と PR をレビューし、repo をまたぐ合わせの PR を出す。自分では repo を受け持たない。席とのやりとりは、TPM 担当を通らず、じかに届く |
| `/devops-engineer` | TPM（`roster assign devops --role devops-engineer`） | DevOps Engineer | project の設定に書いた環境のビルド・デプロイ・整備と、ページの置き場（環境 `pagetray`）と画面のサーバー（環境 `callboard`）を起こして保つこと。共有の環境を変える前に、環境ごとの手続きに従って、TPM 担当への相談か Product Manager の承認を取る |
| `/staff-engineer` | 課題の担当の `roster ask review`（席が無ければ、命令が起こす。依頼書は、命令がレビューの頼みから作る。TPM 担当の `roster assign <課題の Key> --role staff-engineer` は起こし直し） | Staff Engineer | 課題の担当が頼んだ計画・提案のページや PR を、書いた者から離れた目で見て、判定（よい・気になる所あり・直すべき・見られなかった）と指摘をレビューのページで、頼んだ担当へじかに返す（TPM 担当を通らない）。席は課題ごとに、課題の担当の隣に立つ。見て助言するだけで、直さない・決めない（読むだけの守りが掛かる）。受けるかは課題の担当が決める。運びは [運用](/operations/#レビューstaff-engineer-担当の席) |
| `/audit` | Product Manager（`roster audit start` で `Audit` の席を起こし、その席で `/audit`・`/audit <件の番号…>` を呼ぶ） | Auditor | 担当の仕組み（`roster`・skill・決まり・ページの置き場）を証拠で調べ、指摘と勧告を Product Manager へじかに報告する。台帳の出来事の見直し・原因の調べ・追いかけをする。TPM 担当の回し方も見る。直さない・決めない（監査の規程は `_shared/audit-charter.md`）。運びは [運用](/operations/#監査auditor-の席) |
| `audit-evidence` | `/audit`（「調べる」の段で、件ごとに Skill tool で呼ぶ。`user-invocable: false` なので / の一覧に出ない） | Auditor の居場所の助手（`context: fork`・`agent: audit-reader` の subagent。`audit-reader` は Opus で動く読むだけの手伝い。[手伝いの定義](#手伝いの定義claudeagents)） | 台帳の件 1 つについて、時系列のページと関わる記録を読み、事実と証拠の在り処と字を返す。原因・勧告・扱いは出さない。Auditor は指摘に使う証拠を自分で開いて確かめる |
| `figure-fix` | 文書の書き手（提案・計画・結果の「流れ」「前と後」の図の JSON を書いた後に、図ごとに Skill tool で呼ぶ。`user-invocable: false`） | 書き手の居場所の助手（`context: fork`・`model: haiku` の subagent） | 図の JSON 1 つを、Archify の検査が通るまで箱の位置だけ直し、`roster figure embed` で整えて置く用の file に埋め、`roster figure shot` の寸法の検査の結果と、画像の助言（寸法で数えにくい傷）を返す。図の意味（線の端・帯・字）は変えない |
| `/dependabot-triage` | Product Manager が言ったとき、TPM | TPM | Dependabot の PR を集め、依存の version の公開から 72 時間を判定し、対象の PR ごとに Sustaining Engineer 担当を起こす。merge と居場所を閉じるのも TPM 担当。`dry-run` で表だけ、`max=<n>` で同時に動かす Sustaining Engineer 担当の数 |
| `dependabot-scan` | `/dependabot-triage`（Skill tool で呼ぶ。`user-invocable: false` なので / の一覧に出ない） | TPM の居場所の助手（`context: fork` の subagent） | Dependabot の PR を集め、公開からの時間と CI を判定して、表を 1 つ返す。誰も起こさず、知らせも送らない。PR ごとの命令の出力が TPM 担当の会話に残らない |
| `/sustaining-engineer` | TPM（`roster assign "<repo>#<PR>" --role sustaining-engineer`） | Sustaining Engineer | PR 1 本を受け持つ。72 時間の確かめ・直し・CI を緑に・TPM 担当に merge を頼む |
