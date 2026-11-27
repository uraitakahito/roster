// 文書に埋めた図を、ブラウザの寸法で検査する（model を使わない）: 字が箱からはみ出す・字と字が重なる・線の字が箱に重なる・映る字が小さすぎる。
// 線が字や枠をかすめるような、寸法で数えにくい傷は数えない（Haiku の画像の検査が助言で拾う）。
// この script の判じは、ブラウザが要るので CI では試さない。Chrome のある手元でだけ流す試験がある（test/figure-chrome.test.ts）。

/** 寸法の検査で見つけた傷 1 つ。 */
export interface Flaw {
  kind: string
  text: string
  node?: string
  px?: number
}

/** 箱の内側に取る余白（映る px。縮めた図では SVG の単位に直して当てる）。字の外枠がこの内に入らなければ「はみ出し」。 */
export const INSET = 6;
/** これより小さく映る字は「小さい字」（px）。 */
export const MIN_PX = 9.5;

/** ブラウザで動かす検査（結果は `<pre id="roster-figure-check">` に JSON で書く。Chrome の --dump-dom で読む）。 */
export const CHECK_SCRIPT = `(() => {
  const out = [];
  const inside = (a, b, m) => a.x >= b.x + m && a.y >= b.y + m && a.x + a.width <= b.x + b.width - m && a.y + a.height <= b.y + b.height - m;
  // 重なりは、縦と横の両方が 1px（映る px）を超えた時だけ数える（枠の線に触れるだけの所は数えない）。
  let tol = 1;
  const hit = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tol && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > tol;
  for (const svg of document.querySelectorAll('svg[data-fig="archify"]')) {
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    tol = 1 / scale;
    for (const t of svg.querySelectorAll('text')) {
      const px = parseFloat(getComputedStyle(t).fontSize) * scale;
      if (px < ${MIN_PX}) out.push({ kind: '小さい字', text: t.textContent, px: Math.round(px * 10) / 10 });
    }
    const nodes = [...svg.querySelectorAll('[data-node-id]')].map(g => ({ g, r: [...g.querySelectorAll('rect')].find(r => !r.classList.contains('c-mask')) })).filter(n => n.r);
    const texts = [];
    for (const n of nodes) {
      const rb = n.r.getBBox();
      for (const t of n.g.querySelectorAll('text')) {
        const b = t.getBBox();
        texts.push({ t, b });
        if (!inside(b, rb, ${INSET} / scale)) out.push({ kind: 'はみ出し', text: t.textContent, node: n.g.getAttribute('data-node-id') });
      }
    }
    // 線の字の地（c-mask）が箱に重なると、線の矢じりや箱の枠を隠す。
    for (const m of svg.querySelectorAll('g[data-edge-label] > rect.c-mask')) {
      const b = m.getBBox();
      const label = m.parentNode.querySelector('text');
      for (const n of nodes) if (hit(b, n.r.getBBox())) out.push({ kind: '線の字の地が箱に重なる', text: label ? label.textContent : '', node: n.g.getAttribute('data-node-id') });
    }
    for (const g of svg.querySelectorAll('g[data-edge-label]')) for (const t of g.querySelectorAll('text')) {
      const b = t.getBBox();
      texts.push({ t, b });
      for (const n of nodes) if (hit(b, n.r.getBBox())) out.push({ kind: '線の字が箱に重なる', text: t.textContent, node: n.g.getAttribute('data-node-id') });
    }
    // 箱の中でも線の字でもない字（帯の名など）も、箱と重ならないかを見る。
    const placed = new Set(texts.map(x => x.t));
    for (const t of svg.querySelectorAll('text')) {
      if (placed.has(t)) continue;
      const b = t.getBBox();
      texts.push({ t, b });
      for (const n of nodes) if (hit(b, n.r.getBBox())) out.push({ kind: '字が箱に重なる', text: t.textContent, node: n.g.getAttribute('data-node-id') });
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++)
      if (hit(texts[i].b, texts[j].b)) out.push({ kind: '字の重なり', text: texts[i].t.textContent + ' / ' + texts[j].t.textContent });
  }
  const pre = document.createElement('pre');
  pre.id = 'roster-figure-check';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();`;

/** Chrome の --dump-dom の出力から、検査の結果を読む。読めなければ undefined。 */
export function readFlaws(dom: string): Flaw[] | undefined {
  const m = /<pre id="roster-figure-check">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return undefined;
  const text = (m[1] ?? '').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  return JSON.parse(text) as Flaw[];
}

/** 傷 1 つを 1 行の字にする。 */
export function flawLine(f: Flaw): string {
  const where = f.node === undefined ? '' : `（箱 ${f.node}）`;
  const px = f.px === undefined ? '' : `（${f.px}px）`;
  return `${f.kind}: ${f.text}${where}${px}`;
}
