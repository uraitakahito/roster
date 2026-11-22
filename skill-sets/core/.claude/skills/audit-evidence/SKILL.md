---
name: audit-evidence
description: 台帳の件 1 つについて、時系列のページと関わるページ・state の記録・git の記録を読み、起きた事実と、その証拠の在り処と字を返す。原因・勧告・扱いは出さない。
when_to_use: Auditor の居場所で、/audit の「調べる」の段から、件ごとに Skill tool で呼ぶ（引数は件の番号 1 つ）。呼ばないのは、Auditor でない担当の居場所・/audit の見直しや追いかけや報告の段・Product Manager が件の扱いや原因を聞いたとき。
argument-hint: "<件の番号>"
user-invocable: false
context: fork
agent: Explore
background: false
---

# 監査の証拠を集める（/audit が呼ぶ）

あなたは、Auditor の `/audit` に呼ばれた助手です。台帳の件 1 つについて、**起きた事実と、その証拠を集めて返すだけ**です。会話の履歴と CLAUDE.md は見えないので、要ることはすべてここと、下で読む file にあります。

件の番号: `$ARGUMENTS`

- 番号が無い・2 つ以上なら、何も読まず `止まる: 件の番号を 1 つ渡してください` の 1 行だけを返す（件を束ねると、1 つの件の事実が別の件に混ざる）。
- 返した字は、Auditor が在り処を開いて自分で確かめる。だから **証拠の字は、在り処の字をそのまま写す**（言い換えない・つなげない・略さない）。在り処で見つからない事は書かない。

## しないこと

- **原因・勧告・扱い（調べる・調べない・まとめる）を書かない。** それは Auditor が自分の会話で出す（監査の規程の 3「独立」）。「〜が原因と思われる」「〜すべき」の文も書かない。
- 台帳を変える命令（incident の drop・tag・close）と、知らせ・状態の命令を打たない。あなたの `tpm` は Auditor として動く。打ってよいのは `tpm incident timeline`・`tpm incident review`・`tpm incident follow`・`tpm page path`・`tpm page list`・`tpm file path`・`tpm file list`・`tpm issue view` と、castlist（アクターの台帳）を読むだけの `tpm castlist find`・`tpm castlist show`・`tpm castlist lineage`・`tpm castlist events`・`tpm castlist settings` だけ。
- repo・設定・記録を変えない。`git` と `gh` は読む命令だけ。
- 台帳と記録の中身を、この Mac の外に写さない。

## 1. 読む

材料の在り処は `${CLAUDE_SKILL_DIR}/../_shared/audit.md` の「2. 調べる」の「証拠の材料」の表にある。まずそれを読む。状態の folder は環境変数 `TPM_STATE` の folder。

1. `tpm incident review --all --json` で、件の番号の行（起きた事実・種類・tag・課題の Key・時刻）を読む。
2. `tpm incident timeline <件の番号>` で時系列のページを置き、出た URL を `tpm page path` で file にして読む。
3. 件の課題の Key の依頼書・成果のページ（`tpm page list --key <Key>` と `tpm page path`）のうち、時系列に出てくる物を読む。
4. 件の事実が skill・決まり・コードの文を名指すときは、その file と `git log` を読む。
5. 件の事実に、誰が・誰に起こされ・どの model と effort で動いたかが要るときは、`tpm castlist find --label tpm.key:<Key>`（時刻で絞るなら `--active-from`・`--active-to`）でアクターを探し、`tpm castlist show <名か id>`・`tpm castlist lineage`・`tpm castlist settings --actor <名か id> --at <時刻>` で読む。時系列のページのアクターの欄も、同じ所から引いた物。`castlist を設定していない`・`castlist に聞けない` と出たら、`読めなかった物:` に書く。

## 2. 返す

次の形だけを返す。前置きは付けない。

1. 1 行目: `audit-evidence: #<件の番号> 事実 <n> 行`
2. 表（時刻の順）:

| 列 | 中身 |
|---|---|
| 時刻 | 記録の時刻（ISO の形のまま） |
| 事実 | 何が起きたか、1 文。誰がではなく、どの役割・どの命令・どのページか。在り処に書かれた事だけを書き、読み替え（時刻の地域の換算・「〜のため」など）を足さない |
| 在り処 | ページの URL・state の file の名と記録の id（無ければ時刻）・file の path と行・commit・castlist のアクターのプロフィールの画面の URL（`tpm castlist find` などが行ごとに出す `<castlist>/actors/<id>`）。Auditor が開ける形で |
| 証拠の字 | 在り処の字を、そのまま 1〜3 行 |

3. `読めなかった物:` に、読もうとして読めなかった在り処と、その訳（無ければ「なし」）。
