// Archify の SVG を、文書の図の決まり（_shared/figures.md）の形に整える。
// 外す物: 埋め込みの字形・Archify の CSS・metadata（NOTICE の文）・絵の印（icon）・対話の印。
// 足す物: 文書の色の変数を当てる style（図ごと）・幅の指定・lang="ja"・role="img" と aria-label・図ごとの id の頭・作図の 1 行の注。
import { LABEL_PX, PAGE_WIDTH, scaleOf, SUB_PX } from './fit.ts';

/** 整える時に要る物。 */
export interface TidyOptions {
  /** 図ごとの頭（id と style の class に付ける。英数字と - だけ）。 */
  prefix: string
  /** 作図の注に書く Archify の版（v3.3.2 など）。 */
  version: string
}

/** 色の変数を当てる style（図ごとに class で閉じる）。 */
function styleFor(p: string): string {
  const s = `.${p}`;
  return [
    `${s} .t-primary{fill:var(--fg)}`,
    `${s} :is(.t-muted,.t-dim,[class^="t-edge"]){fill:var(--mute)}`,
    `${s} [class^="t-"]:not(.t-primary,.t-muted,.t-dim,[class^="t-edge"]){fill:var(--fg)}`,
    `${s} .c-mask{fill:var(--bg);stroke:none}`,
    `${s} :is(.c-lane,.c-lane-rule,.c-region,.c-security-group){fill:none;stroke:var(--line)}`,
    `${s} .c-lane-wash{fill:var(--card);stroke:none}`,
    `${s} .c-external{fill:var(--bg);stroke:var(--line)}`,
    `${s} :is(.c-backend,.c-frontend){fill:var(--bg);stroke:var(--a)}`,
    `${s} .c-security{fill:var(--bg);stroke:var(--ng)}`,
    `${s} .c-cloud{fill:var(--bg);stroke:var(--mid)}`,
    `${s} :is(.c-database,.c-messagebus){fill:var(--bg);stroke:var(--ok)}`,
    `${s} [data-node-id]>rect:not(.c-mask){stroke-width:2px}`,
    `${s} :is(path,line,polyline)[data-edge-from]{fill:none;stroke:var(--mute)}`,
    `${s} marker :is(polygon,path){fill:var(--mute)}`,
    `${s} .c-grid{display:none}`,
    `${s} text{font-family:inherit}`,
  ].join('');
}

/** 箱の中の字を、箱の上下の中ほどに並べ直す（字を大きくした分、上の枠に寄るため）。 */
function centerNodeTexts(svg: string): string {
  return svg.replace(/<g [^>]*data-node-id="[^"]*"[^>]*>[\s\S]*?<\/text>\s*<\/g>/g, (group) => {
    const r = /<rect [^>]*?y="([-0-9.]+)"[^>]*?height="([0-9.]+)"/.exec(group);
    if (!r) return group;
    const sizes = [...group.matchAll(/<text [^>]*?font-size="([0-9.]+)"/g)].map(m => Number(m[1]));
    if (sizes.length === 0) return group;
    const gap = sizes.length > 1 ? (sizes[0] ?? 0) * 0.35 : 0;
    const total = sizes.reduce((a, b) => a + b, 0) + gap * (sizes.length - 1);
    let y = Number(r[1]) + Number(r[2]) / 2 - total / 2;
    return group.replace(/(<text [^>]*?y=")([-0-9.]+)("[^>]*?font-size="([0-9.]+)")/g, (_m, head: string, _old: string, tail: string, fs: string) => {
      y += Number(fs);
      const at = y - Number(fs) * 0.15;
      y += gap;
      return `${head}${at.toFixed(1)}${tail}`;
    });
  });
}

/** Archify の SVG（明るい用の 1 枚）を整える。 */
export function tidySvg(source: string, options: TidyOptions): string {
  const p = options.prefix;
  if (!/^[a-z][a-z0-9-]*$/.test(p)) throw new Error(`図の頭は英小文字・数字・- にしてください: ${p}`);
  const scale = scaleOf(source);
  let s = source;
  s = s.replace(/<\?xml[^>]*\?>\s*/, '');
  s = s.replace(/<style>[\s\S]*?<\/style>/g, '');
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<desc[^>]*>[\s\S]*?<\/desc>/g, '');
  s = s.replace(/<rect class="archify-bake-background"[^>]*\/>/g, '');
  s = s.replace(/<pattern[\s\S]*?<\/pattern>/g, '');
  s = s.replace(/<rect [^>]*url\(#grid\)[^>]*\/>/g, '');
  s = s.replace(/<g [^>]*data-semantic-sigil[^>]*>[\s\S]*?<\/g>/g, '');
  // 字を大きくする: 縮めた後に箱の名・帯の名（Archify の 10 以上）は 13px、補い・線の字（10 より小さい）は 10px で映るように。
  const big = (LABEL_PX / scale).toFixed(1);
  const small = (SUB_PX / scale).toFixed(1);
  s = s.replace(/font-size="([0-9.]+)"/g, (_m, v: string) => `font-size="${Number(v) >= 10 ? big : small}"`);
  // 線の字の地（c-mask の rect）を、大きくした字に合わせて広げる（中心はそのまま）。
  const grow = SUB_PX / scale / 8;
  s = s.replace(/(<g [^>]*data-edge-label="[^"]*"[^>]*>\s*)<rect x="([-0-9.]+)" y="([-0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g, (_m, head: string, x: string, y: string, w: string, h: string) => {
    const nw = Number(w) * grow;
    const nh = Number(h) * grow;
    const cx = Number(x) + Number(w) / 2;
    const cy = Number(y) + Number(h) / 2;
    return `${head}<rect x="${(cx - nw / 2).toFixed(1)}" y="${(cy - nh / 2).toFixed(1)}" width="${nw.toFixed(1)}" height="${nh.toFixed(1)}"`;
  });
  s = centerNodeTexts(s);
  // 対話の印（文書の図では働かない）を外す。
  s = s.replace(/\s(tabindex|aria-pressed|data-animate|role)="[^"]*"/g, '');
  s = s.replace(/\saria-label="Focus [^"]*"/g, '');
  s = s.replace(/\sstyle="--step:[0-9]+"/g, '');
  // id に図ごとの頭を付け、中の参照も替える（1 ページに図を 2 つ置いても重ならない）。
  const ids = [...new Set([...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1] ?? ''))];
  for (const id of ids) {
    s = s.replaceAll(`id="${id}"`, `id="${p}-${id}"`).replaceAll(`url(#${id})`, `url(#${p}-${id})`);
  }
  const title = /<title id="[^"]*">([^<]*)<\/title>/.exec(s)?.[1] ?? '図';
  s = s.replace(/<svg\b[^>]*>/, (root) => {
    const vb = /viewBox="([^"]+)"/.exec(root)?.[1] ?? `0 0 ${PAGE_WIDTH} 280`;
    const width = Math.min(PAGE_WIDTH, Number(vb.split(/\s+/)[2] ?? PAGE_WIDTH));
    return `<svg viewBox="${vb}" width="100%" role="img" lang="ja" aria-label="${title}" data-fig="archify" class="${p}" style="max-width:${Math.round(width)}px" xmlns="http://www.w3.org/2000/svg"><!-- 作図: Archify ${options.version}（Apache-2.0） --><style>${styleFor(p)}</style>`;
  });
  s = s.replace(/<title id="[^"]*">[^<]*<\/title>/, '');
  s = s.replace(/>\s+</g, '><').trim();
  return s;
}
