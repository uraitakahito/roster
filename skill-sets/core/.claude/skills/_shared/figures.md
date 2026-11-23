# ページの図のひな形（どの担当も使う）

ページ（確認・提案・計画・結果・監査）に入れる図のひな形。どのページにどの図を入れるかは `protocol.md` の「ページ」の図の項にある。ここには描き方だけを置く。

図はページの中に inline の SVG で描く（file に上げない）。下の形を写し、字と数と幅だけ替える。

## 描き方の決まり

- 図の中の字は SVG の `<text>` で書く（画像の中の字にしない）。`<svg>` に `role="img"` と `aria-label="<何の図か>"` を付け、図の下に `<figcaption>` で「図 N: …」と書く。
- 色は下の色の変数だけを使う（`fill="var(--ok)"` など）。明るい画面と暗い画面の両方で読める。字は `svg text{fill:var(--fg)}` で色が付くので、字に色を書かない（色を付けるときは `style="fill:var(--ng)"`）。
- `viewBox` の幅は 760 まで、`width="100%"` と `style="max-width:<幅>px"` を付ける（狭い画面では縮む）。字は 13〜14px。日本語の字は 1 字がおよそ字の大きさの幅になるので、枠や棒の幅は字の数 × 14 より広く取る。
- 色だけで違いを示さない。棒や枠の横に、字（「0 回」「お勧め」など）も書く。
- 図は 1 つに言うことを 1 つ。表で言える細かい数は表に任せる。
- 描いたら、置く前に Chrome の headless で撮って Read で見て、字のはみ出しと重なりがないかを確かめる（下の「画面の写しを撮る」の 1 行。撮った png は上げなくてよい）。

## 色の変数（ページの `<style>` に 1 度書く）

```css
:root{--bg:#fff;--fg:#1f2328;--mute:#59636e;--line:#d1d9e0;--card:#f6f8fa;--a:#1f6feb;--ok:#1a7f37;--mid:#bf8700;--ng:#cf222e}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#9198a1;--line:#3d444d;--card:#151b23;--a:#4493f8;--ok:#3fb950;--mid:#d29922;--ng:#f85149}}
body{background:var(--bg);color:var(--fg)}
a{color:var(--a)}
svg text{fill:var(--fg);font-family:inherit}
figcaption{color:var(--mute);font-size:13px}
```

| 変数 | 使い所 |
|---|---|
| `--fg`・`--mute` | 字・補いの字 |
| `--line` | 枠・今の物（変えない物）・棒の地 |
| `--a` | 変える物・新しい物・強調 |
| `--ok`・`--mid`・`--ng` | 良い・中ほど・悪い（手間の大小など。お勧めの道は `--a`） |

## 1. 選ぶ問いの木（確認・提案の選択肢）

選択肢を、Product Manager が答えれば決まる問いの木にする。性質（手間・速さ・変える所など）を並べる比べは表に任せ、図には描かない（棒の長さで性質を並べる図は、表のくり返しになり、棒の向きも読む人が読み解く要がある。2026-11-23 t-uepv）。

- 問いは Product Manager が答えられる物（先の予定・好み・許せる事）にする。技術の細かい差は書き手が答えて表に書く。
- 問いは 1〜2 つ。3 つ以上要るなら、選択肢を減らすか項目を分ける。
- どの選択肢も、どこかの葉に置く。
- 線の横に答え（「はい」「いいえ」か短い答え）を字で書く。
- 書き手の見立ての道（線と葉の枠）を `--a` の太線にし、お勧めの葉に「（お勧め）」と書く。ほかの線は `--mute`、葉の枠は `--line`。`<figcaption>` に「見立て: <どう答えると見たか・訳>」を書く（SVG の字は折り返さないので、SVG の中に置かない）。
- `<svg>` に `data-fig="tree"` を付ける（見直しで数えるため）。
- Product Manager が答えて選びが決まる問いが無い項目（2 択で違いが 1 つ・違いが技術の差だけで書き手が決められる、など）は図を入れず、表の上に「図: 無し。<訳>」と 1 行書く。技術の問いを Product Manager に投げるために木を作らない。

```html
<figure>
<svg viewBox="0 0 760 220" width="100%" role="img" data-fig="tree" aria-label="ER 図の 3 案を選ぶ問いの木" style="max-width:760px">
  <defs><marker id="tree" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--mute)"/></marker>
  <marker id="tree-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--a)"/></marker></defs>
  <g font-size="13">
    <rect x="10" y="95" width="210" height="50" rx="8" fill="none" stroke="var(--fg)" stroke-width="2"/>
    <text x="115" y="117" text-anchor="middle">問い 1: 表は、これから</text><text x="115" y="135" text-anchor="middle">よく増えるか？</text>
    <rect x="290" y="20" width="220" height="50" rx="8" fill="none" stroke="var(--fg)" stroke-width="2"/>
    <text x="400" y="42" text-anchor="middle">問い 2: site に JavaScript</text><text x="400" y="60" text-anchor="middle">（3 MB）を足してよいか？</text>
    <rect x="290" y="160" width="250" height="50" rx="8" fill="none" stroke="var(--a)" stroke-width="3"/>
    <text x="415" y="182" text-anchor="middle" font-weight="bold">B. 手の SVG（お勧め）</text><text x="415" y="200" text-anchor="middle">小さく直す・表は手で足す</text>
    <rect x="600" y="2" width="150" height="40" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="675" y="27" text-anchor="middle">A. mermaid</text>
    <rect x="600" y="56" width="150" height="40" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="675" y="81" text-anchor="middle">C. DB から作る</text>
    <line x1="220" y1="110" x2="288" y2="50" stroke="var(--mute)" stroke-width="2" marker-end="url(#tree)"/><text x="232" y="70">はい</text>
    <line x1="220" y1="130" x2="288" y2="182" stroke="var(--a)" stroke-width="3" marker-end="url(#tree-a)"/><text x="214" y="192" style="fill:var(--a)">いいえ</text>
    <line x1="510" y1="38" x2="598" y2="24" stroke="var(--mute)" stroke-width="2" marker-end="url(#tree)"/><text x="528" y="22">はい</text>
    <line x1="510" y1="56" x2="598" y2="74" stroke="var(--mute)" stroke-width="2" marker-end="url(#tree)"/><text x="524" y="84">いいえ</text>
  </g>
</svg>
<figcaption>図 1: ER 図の 3 案を選ぶ問い（青い道が書き手の見立て）。見立て: 表は 0001 から 8 つのまま（移行は 3 つ）なので「いいえ」</figcaption>
</figure>
```

問いが 1 つなら、問い 2 の箱を消し、問い 1 から葉へ線を引く。葉を足すときは、葉の `y` を 54 ずつ足し、`viewBox` の高さも足す。線の横の答えが 3 字を超えるなら、葉の `x` を超えた字の数 × 14 だけ右へ寄せ、葉の幅をその分縮める（答えの字を矢じりに触れさせない）。1 ページに木を 2 つ以上置くときは、`marker` の `id` を図ごとに替える（`tree2`・`tree2-a`…）。

## 2. 流れ（提案・計画の段、命令やデータの通り道）

箱を左から右へ並べ、矢印でつなぐ。変える箱だけ `--a` の枠にする。

```html
<figure>
<svg viewBox="0 0 720 90" width="100%" role="img" aria-label="段の流れ" style="max-width:720px">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--mute)"/></marker></defs>
  <g font-size="14">
    <rect x="10" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="85" y="48" text-anchor="middle">決まりを読む</text>
    <rect x="200" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--a)" stroke-width="2"/><text x="275" y="48" text-anchor="middle">図を描く</text>
    <rect x="390" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="465" y="48" text-anchor="middle">roster page put</text>
    <rect x="580" y="20" width="130" height="46" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="645" y="48" text-anchor="middle">PM が読む</text>
    <line x1="160" y1="43" x2="198" y2="43" stroke="var(--mute)" stroke-width="2" marker-end="url(#arrow)"/>
    <line x1="350" y1="43" x2="388" y2="43" stroke="var(--mute)" stroke-width="2" marker-end="url(#arrow)"/>
    <line x1="540" y1="43" x2="578" y2="43" stroke="var(--mute)" stroke-width="2" marker-end="url(#arrow)"/>
  </g>
</svg>
<figcaption>図 2: ページができるまで（枠の青い所を変える）</figcaption>
</figure>
```

1 ページに `marker` のある図を 2 つ以上置くときは、`id` を図ごとに替える（`arrow`・`arrow2`…。同じ `id` は先の物が使われる）。箱が 5 つを超えるなら、2 段に折るより、表にする。

## 3. 前と後（計画・結果）

左に今、右に後を並べ、違う行だけ後の側で `--a` か `--ok` の色を付ける。

```html
<figure>
<svg viewBox="0 0 760 170" width="100%" role="img" aria-label="今と後の比べ" style="max-width:760px">
  <defs><marker id="arrow3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--mute)"/></marker></defs>
  <g font-size="13">
    <text x="10" y="16" font-weight="bold">今</text>
    <rect x="10" y="26" width="320" height="130" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/>
    <text x="24" y="56">決まり: 1 行</text>
    <text x="24" y="88">確認の書き方: 表か図</text>
    <text x="24" y="120" style="fill:var(--ng)">確認のページの図: 0 / 7</text>
    <line x1="340" y1="90" x2="410" y2="90" stroke="var(--mute)" stroke-width="2" marker-end="url(#arrow3)"/>
    <text x="420" y="16" font-weight="bold">後</text>
    <rect x="420" y="26" width="330" height="130" rx="8" fill="none" stroke="var(--a)" stroke-width="2"/>
    <text x="434" y="56">決まり: 種類ごとの表</text>
    <text x="434" y="88">確認の書き方: 表と図</text>
    <text x="434" y="120" style="fill:var(--ok)">7 日後に測る</text>
  </g>
</svg>
<figcaption>図 3: 今の決まりと、変えた後の決まり</figcaption>
</figure>
```

行を足すときは `y` を 32 ずつ足し、枠の `height` と `viewBox` の高さも 32 足す。

## 4. 数の棒（結果・監査の数、推移）

数を縦の棒で並べる。棒の高さは「数 × 1 つの高さ」、棒の上に数を字で書く。下の例は 1 件 = 10px、地の線は y=130。

```html
<figure>
<svg viewBox="0 0 400 170" width="100%" role="img" aria-label="日ごとの件数" style="max-width:400px">
  <g font-size="13">
    <line x1="30" y1="130" x2="390" y2="130" stroke="var(--line)" stroke-width="2"/>
    <rect x="50" y="100" width="40" height="30" fill="var(--a)"/><text x="70" y="94" text-anchor="middle">3</text><text x="70" y="150" text-anchor="middle">11-20</text>
    <rect x="130" y="60" width="40" height="70" fill="var(--a)"/><text x="150" y="54" text-anchor="middle">7</text><text x="150" y="150" text-anchor="middle">11-21</text>
    <rect x="210" y="30" width="40" height="100" fill="var(--a)"/><text x="230" y="24" text-anchor="middle">10</text><text x="230" y="150" text-anchor="middle">11-22</text>
    <rect x="290" y="110" width="40" height="20" fill="var(--a)"/><text x="310" y="104" text-anchor="middle">2</text><text x="310" y="150" text-anchor="middle">11-23</text>
    <text x="30" y="166" font-size="12" style="fill:var(--mute)">1 件 = 10px</text>
  </g>
</svg>
<figcaption>図 4: 日ごとの件数</figcaption>
</figure>
```

## 5. 並べ（監査の勧告など、1 つを選ぶのでない物）

1 つを選ぶのでない物（監査の勧告ごとの手間など）を、棒で並べる。確認・提案のページには使わない（選択肢は「1. 選ぶ問いの木」、項目ごとに「する・見送る」を決める物も表にする）。棒は長いほど手間が大きい、に決める（良さを棒にしない）。値は「小・中・大」の字を棒の横に書く。`<svg>` に `data-fig="bars"` を付ける（見直しで数えるため）。

```html
<figure>
<svg viewBox="0 0 620 130" width="100%" role="img" data-fig="bars" aria-label="勧告ごとの手間の並べ" style="max-width:620px">
  <g font-size="13">
    <text x="150" y="16">直す手間（長いほど大きい）</text><text x="420" y="16">効く件</text>
    <text x="0" y="50">R1 命令で止める</text>
    <rect x="150" y="38" width="160" height="16" rx="3" fill="var(--ng)"/><text x="318" y="51">大</text>
    <text x="420" y="51">#12・#53</text>
    <text x="0" y="85">R2 文に足す</text>
    <rect x="150" y="73" width="30" height="16" rx="3" fill="var(--ok)"/><text x="188" y="86">小</text>
    <text x="420" y="86">#12</text>
    <text x="0" y="120">R3 試験を足す</text>
    <rect x="150" y="108" width="90" height="16" rx="3" fill="var(--mid)"/><text x="248" y="121">中</text>
    <text x="420" y="121">#56</text>
  </g>
</svg>
<figcaption>図 1: 勧告ごとの直す手間と効く件</figcaption>
</figure>
```

行を足すときは、行ごとに `y` を 35 ずつ足し、`viewBox` の高さも 35 足す。

## 画面の写しを撮る（画面を変えた結果）

画面（置き場の一覧の UI・docs の site など）を変えた結果は、前と後の写しを png にして `roster file put <file> --reviewed` で上げ、ページから `<img src="files/<語>-<n>.png">` で参照する（`protocol.md` の「ページ」の file の項）。roster を動かす機械の Chrome の headless で撮れる:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$TMPDIR/shot-chrome" --window-size=900,700 --screenshot="$TMPDIR/shot.png" "<URL か file:// の path>"
```

- 写るのは開いたページだけ（ほかの窓や通知は写らない）。それでも上げる前に Read で見て、token・鍵・個人の情報・roster を動かす機械の path が写っていないか確かめる。
- 暗い画面で撮るときは `--force-dark-mode` を足す。長いページは `--window-size` の高さを増やす。
