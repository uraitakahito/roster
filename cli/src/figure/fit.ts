// workflow の図の箱の幅を、映る字の大きさ（箱の名 13px・補いの字 10px）から決める。
// Archify は描く幅を自分で決め（決まった幅より狭くはできない）、整える時に文書の幅（760）へ縮める。縮める分だけ字を大きくし、その字が入る幅を箱に書く。

/** 映る箱の名・帯の名の字の大きさ（px）。 */
export const LABEL_PX = 13;
/** 映る補い・線の字の大きさ（px）。 */
export const SUB_PX = 10;
/** 文書の中の図の幅（px）。 */
export const PAGE_WIDTH = 760;
/** 箱の左右の余白の和（字の外。映る px）。 */
const PAD = 48;
/** Archify の箱の幅の既定（これより狭くしない）。 */
const MIN_WIDTH = 92;
/** Archify の箱の高さの既定（これより低くしない）。 */
const MIN_HEIGHT = 52;
/** 箱の上下の余白（字の外。映る px。寸法の検査の余白 6 より広く取る）。 */
const V_PAD = 9;

/** 字の幅の見立て（px）。日本語・全角は 1 字、英数字の大文字と数字は 0.65 字、ほかは 0.55 字、空白は 0.3 字。 */
export function textWidth(text: string, px: number): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c > 0x2e7f) w += 1;
    else if (ch === ' ') w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.65;
    else w += 0.55;
  }
  return w * px;
}

/** 箱の幅（Archify の SVG の単位）: 映る字の幅に左右の余白を足し、縮める分だけ広げる。 */
function nodeWidth(n: { label?: string, sublabel?: string }, scale: number): number {
  return Math.max(MIN_WIDTH, Math.ceil((Math.max(textWidth(n.label ?? '', LABEL_PX), textWidth(n.sublabel ?? '', SUB_PX)) + PAD) / scale));
}

/** 箱の高さ（Archify の SVG の単位）: 映る字の行（1 行は字の 1.25 倍、行の間は箱の名の 0.35 倍）に上下の余白を足し、縮める分だけ高くする。 */
function nodeHeight(n: { sublabel?: string }, scale: number): number {
  const lines = n.sublabel === undefined || n.sublabel === '' ? LABEL_PX * 1.25 : (LABEL_PX + SUB_PX) * 1.25 + LABEL_PX * 0.35;
  return Math.max(MIN_HEIGHT, Math.ceil((lines + 2 * V_PAD) / scale));
}

/** 図の JSON の形のうち、ここで読む・書く所。 */
export interface FigureJson {
  diagram_type?: string
  meta?: Record<string, unknown>
  nodes?: { label?: string, sublabel?: string, width?: number, height?: number }[]
  [k: string]: unknown
}

/**
 * 図の JSON を、文書に載せる形にする（元は変えない）: 検査は standard・凡例を消す・言葉の欄（locale）と描く幅（viewBox）は Archify に任せる。
 * workflow なら、縮める割合 scale（1 以下）で映る字が入るよう、箱の幅を決める。
 */
export function fitFigure(json: FigureJson, scale: number): FigureJson {
  const meta: Record<string, unknown> = { ...json.meta, quality_profile: 'standard', legend: { mode: 'hidden' } };
  delete meta.viewBox;
  delete meta.locale;
  const out: FigureJson = { ...json, meta };
  if (json.diagram_type === 'workflow' && Array.isArray(json.nodes)) {
    out.nodes = json.nodes.map(n => ({ ...n, width: nodeWidth(n, scale), height: nodeHeight(n, scale) }));
  }
  return out;
}

/** Archify の SVG の描く幅（viewBox の 3 つ目）から、文書の幅へ縮める割合（1 以下）。 */
export function scaleOf(svg: string): number {
  const width = viewBoxOf(svg)[2] ?? PAGE_WIDTH;
  return Math.min(1, PAGE_WIDTH / width);
}

/** 根の svg の viewBox の 4 つの数（空白か , で割る）。無ければ空。 */
export function viewBoxOf(svg: string): number[] {
  const v = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg)?.[1];
  return v === undefined ? [] : v.trim().split(/[\s,]+/).map(Number);
}
