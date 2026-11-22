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
| `--ok`・`--mid`・`--ng` | 良い・中ほど・悪い（お勧め・手間の大小など） |

## 1. 比べ（確認・提案の選択肢）

選択肢を、Product Manager が比べる物（手間・速さ・変える所など）で並べる。棒の長さは大きいほど悪い物（手間・回数）にそろえ、横に値を字で書く。お勧めには「（お勧め）」と書く。

```html
<figure>
<svg viewBox="0 0 620 130" width="100%" role="img" aria-label="選択肢の比べ" style="max-width:620px">
  <g font-size="13">
    <text x="150" y="16">Product Manager の手間</text><text x="420" y="16">変える所</text>
    <text x="0" y="50">案 A（お勧め）</text>
    <rect x="150" y="38" width="30" height="16" rx="3" fill="var(--ok)"/><text x="188" y="51">押さない</text>
    <text x="420" y="51">script だけ</text>
    <text x="0" y="85">案 B</text>
    <rect x="150" y="73" width="90" height="16" rx="3" fill="var(--mid)"/><text x="248" y="86">戻るたび</text>
    <text x="420" y="86">script と server</text>
    <text x="0" y="120">案 C</text>
    <rect x="150" y="108" width="160" height="16" rx="3" fill="var(--ng)"/><text x="318" y="121">毎回</text>
    <text x="420" y="121">server だけ</text>
  </g>
</svg>
<figcaption>図 1: 案ごとの手間と変える所</figcaption>
</figure>
```

選択肢を足すときは、行ごとに `y` を 35 ずつ足し、`viewBox` の高さも 35 足す。

## 2. 流れ（提案・計画の段、命令やデータの通り道）

箱を左から右へ並べ、矢印でつなぐ。変える箱だけ `--a` の枠にする。

```html
<figure>
<svg viewBox="0 0 720 90" width="100%" role="img" aria-label="段の流れ" style="max-width:720px">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--mute)"/></marker></defs>
  <g font-size="14">
    <rect x="10" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="85" y="48" text-anchor="middle">決まりを読む</text>
    <rect x="200" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--a)" stroke-width="2"/><text x="275" y="48" text-anchor="middle">図を描く</text>
    <rect x="390" y="20" width="150" height="46" rx="8" fill="none" stroke="var(--line)" stroke-width="2"/><text x="465" y="48" text-anchor="middle">tpm page put</text>
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

## 画面の写しを撮る（画面を変えた結果）

画面（置き場の一覧の UI・docs の site など）を変えた結果は、前と後の写しを png にして `tpm file put <file> --reviewed` で上げ、ページから `<img src="files/<語>-<n>.png">` で参照する（`protocol.md` の「ページ」の file の項）。tpm を動かす機械の Chrome の headless で撮れる:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$TMPDIR/shot-chrome" --window-size=900,700 --screenshot="$TMPDIR/shot.png" "<URL か file:// の path>"
```

- 写るのは開いたページだけ（ほかの窓や通知は写らない）。それでも上げる前に Read で見て、token・鍵・個人の情報・tpm を動かす機械の path が写っていないか確かめる。
- 暗い画面で撮るときは `--force-dark-mode` を足す。長いページは `--window-size` の高さを増やす。
