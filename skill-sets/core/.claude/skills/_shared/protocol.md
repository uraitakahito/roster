# 担当のあいだの決まり（どの担当も読む）

TPM 担当（`/tpm`）・Software Engineer 担当（`/software-engineer`）・DevOps Engineer 担当（`/devops-engineer`）・Sustaining Engineer 担当（`/sustaining-engineer`）が共通に従う決まり。依頼主は Product Manager（利用者）。返答と報告は日本語で書く。

## 連絡の仕方

```sh
cmux agent message <相手の workspace か surface> --from "<自分の workspace の題>" -- "【見出し】本文"
cmux --json agent inbox --surface <相手の workspace か surface> --limit 3     # 届いたかを見る
```

- 知らせは相手の hook から届く（打ち込みとぶつからない）。返事は、届いた知らせに書かれた `--reply-to <id>` で返してよい。
- 宛先と `--surface` には、surface のほか workspace の ref（`workspace:12`）か題（完全一致か、ほかと重ならない頭の部分）を渡せる。workspace を渡すと、その中の選ばれている surface を指す。担当の workspace は surface が 1 つなので、surface を知らなくても `cmux workspace list` の workspace で足りる（起こし直した後も同じ）。同じ題の workspace が 2 つあると、題では `not_found` になる。
- 送った後は inbox で `delivered` になったかを見る。`queued` のまま相手が入力待ちなら、TPM 担当が `cmux send --workspace <相手の workspace> "<本文>\r"` で打ち込む。
- `--mark-read` は付けない（`--surface` 無しで打つと、全部の宛先を既読にする）。
- 自分の surface と workspace は `cmux identify` の `caller`。
- **Product Manager に直接聞かない。** Product Manager とのやりとりは、すべて TPM 担当を通す。

## 見出し

### TPM 担当へ

| 見出し | いつ | 本文 |
|---|---|---|
| 【相談(TPM)】 | TPM 担当に決めてほしいことがある | 困っていること・試したこと・案とお勧め |
| 【PM への確認】 | Product Manager に決めてほしいことを Jira に書いた（jira.md の「Product Manager に確かめる」） | コメントの URL と各項目の題 |
| 【PM への依頼】 | Product Manager に頼むことを Artifact に書いた | Artifact の URL と要点 |
| 【DevOps への依頼】 | Apple Container・Windmill など共有の環境で DevOps Engineer 担当の手が要る | 何を・なぜ・急ぎか |
| 【ドキュメント修正】 | 文書やコメントの食い違いを直した PR を merge した | PR の URL と一言 |
| 【merge 済み】 | 自分の PR を 1 本 merge した | PR の URL と一言 |
| 【完成】 | 依頼書の成果（提案・計画などの Artifact）を publish した。依頼書が【計画完成】など別の名を決めていればそれを使う | URL と要点 |
| 【終わり】 | 【片付け】を受けて片付けた（Sustaining Engineer 担当は PR を merge した後。`/sustaining-engineer`） | 成果の Artifact の URL・merge した PR・登録した課題・消した worktree・残っている物 |

Dependabot の PR だけで使う見出し（【merge の依頼】【まだ】【作り直し】）は `/sustaining-engineer` と `/dependabot-triage` に書いてある。

### TPM 担当から

| 見出し | 中身 |
|---|---|
| 【依頼】 | 新しい依頼書の URL。Artifact tool の `read` で読み、それに従う |
| 【PM の回答】 | Product Manager の答え。待ちの表示を作業中に戻して続ける |
| 【連絡】 | 知っておくこと（Jira の番号など）。返事は要らない |
| 【TPM の宛先】 | 起こし直した TPM 担当の workspace。これからの知らせは、起こされたときの `tpm=` ではなくここへ送る。返事は要らない |
| 【片付け】 | この課題に続きは無い。worktree・課題の登録・Jira を済ませて【終わり】を返す |

## サイドバー

- 使う鍵は **`model` と `wait` の 2 つだけ**。新しい鍵を作らない（作ると表示が増える）。
- `model`: `cmux set-status model "<model> · <effort>" --icon sparkle --priority 90`。字は `Opus 5.5 · medium` の形。
- `wait`: 「今、誰が何を待っているか」を 1 つだけ。状況が変わるたびに `cmux set-status wait "<字>" --icon hourglass --priority 80` で上書きし、前の表示を残さない。
  - Product Manager の答えを待つ: `回答待ち(PM): <何を>`
  - TPM 担当の答えを待つ: `回答待ち(TPM): <何を>`
  - 自分が動いている: `作業中: <段>`
  - 待つ時間に限りがあれば添える: `回答待ち(TPM): merge（14:30 まで）`
- **`/model`・`/effort` は打たない**（新しい session の既定まで書き換わる）。model と effort は起動の旗で決まる。

## Jira

Jira の課題にコメントを書く・読む・Product Manager に確かめる・状態を進める・課題を登録するときは、同じ folder の `jira.md` を読み、従う。

## 文書の食い違い

TPM 担当は自分で直さず、課題として Software Engineer 担当に回す（`/tpm` の 2）。ほかの担当は、調べている途中で文書やコメントの食い違いを見つけたら、お勧めの直し方で直し、PR を merge まで自分で進める（Product Manager の確認は要らない）。worktree で作業し、PR の題か本文に課題の鍵（Jira の番号か `t-<短い名>`）を入れる。merge したら【ドキュメント修正】で知らせ、成果の Artifact にも一覧で載せる。文書とコードが食い違うときは、コードの方に合わせる。

## 共有の環境

Apple Container・Windmill など、並べて動いている物に響く環境は、DevOps Engineer 担当のほかは変えない。要るときは【DevOps への依頼】で TPM 担当に送る。

## 終わり方

- Software Engineer 担当と DevOps Engineer 担当は、依頼書 1 つが済むごとに【完成】を送り、`wait` を `回答待ち(TPM): 次の依頼` にして次の【依頼】を待つ。同じ課題の続きは同じ担当が受ける。【片付け】が来るまで自分から終えない。
- 自分の workspace は自分で閉じない。【終わり】を送った後、`wait` を `回答待ち(TPM): workspace を閉じる` にする。TPM 担当が報告を受けてから閉じる。
- 自分で作った worktree と branch は、merge の後に消す（`git worktree list` に本体だけが残ること）。
