# Jira を触るときの決まり（TPM・Software Engineer・DevOps Engineer 担当が読む）

Jira の課題にコメントを書く・読む・Product Manager に確かめる・状態を進める・課題を登録するときに読む。命令は `acli`。Sustaining Engineer 担当は Jira を触らない。

## 誰が・いつ書くか

| 担当 | いつ | 種類 |
|---|---|---|
| Software Engineer | 提案・計画・結果の Artifact を出したら 1 件。【完成】【終わり】を送る前に | `提案`・`計画`・`結果` |
| Software Engineer | 文書の食い違いを直した PR を merge したら 1 件 | `文書の修正` |
| Software Engineer | Product Manager に決めてほしいことがある（下の「Product Manager に確かめる」） | `確認` |
| TPM | Product Manager が決めたら 1 件。【PM の回答】を返す前に | `決定` |
| DevOps Engineer | 依頼 1 つが済んだら 1 件。【完成】を送る前に | `結果` |

どれも、依頼に Jira の課題（`jira=`）があるときだけ。依頼書に「Jira にコメントを足す」と書かれていなくても、上の表のとおりに書く。

## コメントの書き方

- 1 行目は `【<種類>】<担当>: <一言>`。担当は `Software Engineer`・`TPM`・`DevOps Engineer`。Jira の書き手はいつも Product Manager のアカウント（acli が Product Manager の認証で書く）なので、担当は字で書く。
- 2 行目から、要点を 1 点 1 段落で 3 つまで。中身は Artifact に書き、コメントには写さない。
- 段落（`paragraph`）だけで書く。箇条書き（`bulletList`・`orderedList`）と `taskList` は使わない。
- リンクは、URL をそのまま字にして `link` の mark を付ける（字も `href` も URL）。PR も `#30` ではなく URL で書き、merge したら「（merge 済み）」を添える。

ひな形（種類で変わるのは 1 行目だけ）:

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "【計画】Software Engineer: 案 B の計画（PR 2 本）"
        }
      ]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "計画: " },
        {
          "type": "text",
          "text": "https://claude.ai/artifact/<id>",
          "marks": [
            {
              "type": "link",
              "attrs": { "href": "https://claude.ai/artifact/<id>" }
            }
          ]
        }
      ]
    },
    { "type": "paragraph", "content": [{ "type": "text", "text": "<要点>" }] }
  ]
}
```

## 書く・直す・読む

```sh
acli jira workitem comment create --key <課題> --body-file <ADF の JSON>         # 書く
acli jira workitem comment update --key <課題> --id <id> --body-adf <ADF の JSON> # 直す
acli jira workitem view <課題> --fields comment --json                            # 読む
```

- **読むのは `workitem view --fields comment --json` だけ。** ADF をそのまま返す。足したコメントの id は `.fields.comment.comments[-1].id`。
- `acli jira workitem comment list --json` は使わない。ADF を平らな字にするので、リンクの `href` が消え、`bulletList` などのリストは丸ごと消える。
- JSON は `python3 -m json.tool <ファイル>` で確かめてから書く。

## Product Manager に確かめる

文書やコメントの食い違い**以外**で Product Manager に決めてほしいことは、HTML の Artifact（確認の Artifact）に書いて【PM への依頼】で送る。Jira の課題があってもなくても同じ。Jira のコメントには中身を写さない。

1. 確認の Artifact を作る。項目ごとに、背景・選択肢・お勧めとその訳を書き、比べる物は表か図にする。
2. publish し、自分の workspace で開く（`cmux open <URL> --workspace <自分の workspace>`）。
3. Jira の課題があれば「確認」のコメントを足す。1 行目の後に、Artifact の URL と、項目の題を 1 項目 1 段落で書く。
4. 【PM への依頼】で URL と各項目の題を TPM 担当に送る。`wait` は `回答待ち(PM): <何を>`。
5. 答えは【PM の回答】で来る。Jira の課題があれば、TPM 担当が「決定」のコメントを書いてある。

## 状態を進める

Software Engineer 担当が【片付け】を受けたら、課題を `完了` にする。【片付け】を送るかは TPM 担当が決める（tpm/SKILL.md の「【片付け】を送るか」）。担当の交代のための【片付け】では進めない。ほかの時にも進めない。

```sh
acli jira workitem transition --key <課題> --status "完了" --yes
```

## 課題を登録する

計画から外れた物・残した物で直した方がよい物は、【片付け】を受けたら課題にして元の課題にリンクする。担当の交代のための【片付け】では登録しない（【終わり】に書き、次の担当が引き継ぐ）。

```sh
acli jira workitem create --project <project> --type タスク --summary "<題>" --description "<説明>"
acli jira workitem link create --out <新しい課題> --in <元の課題> --type Relates --yes   # 種類は acli jira workitem link type
```

- コンポーネントは acli では付けられない。要るときは【終わり】に「付けたいコンポーネント」として書く。
- 課題どうしのリンクを付けたか、付けなかった理由も【終わり】に書く。
