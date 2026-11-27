// roster figure …: 文書の図を Archify で描いて整える（setup・embed・shot）。手順と決まりは _shared/figures.md の「Archify で描く」。
// 書き手の file には目印（<!-- figure: <JSON の path> -->）だけを書き、embed が整えた SVG を埋めた物を別の file（置く用）に出す。
// 書き手（高い model）が SVG の字を書き写さず、文書を直す時も SVG が書き手の文脈に戻らないように。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { Context } from '../context.ts';
import { archifyVersion, runArchify, setupArchify } from '../figure/archify.ts';
import { CHECK_SCRIPT, flawLine, readFlaws } from '../figure/check.ts';
import { fitFigure, PAGE_WIDTH, scaleOf, type FigureJson } from '../figure/fit.ts';
import { tidySvg } from '../figure/tidy.ts';
import { TpmError } from '../skill-sets.ts';

/** 目印の形（書き手の file に書く）。 */
export const MARKER = /<!--\s*figure:\s*(\S+?)\s*-->/g;
/** 箱の幅を決め直す回の上限（2〜4 回で決まる。決まらない図は字が長すぎる）。 */
const MAX_ROUNDS = 5;
/** Chrome の既定の在り処（$ROSTER_CHROME で替える）。 */
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** 文書に style が無い時の色の変数（figures.md の「色の変数」）。 */
const DEFAULT_STYLE = ':root{--bg:#fff;--fg:#1f2328;--mute:#59636e;--line:#d1d9e0;--card:#f6f8fa;--a:#1f6feb;--ok:#1a7f37;--mid:#bf8700;--ng:#cf222e}@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#9198a1;--line:#3d444d;--card:#151b23;--a:#4493f8;--ok:#3fb950;--mid:#d29922;--ng:#f85149}}body{background:var(--bg);color:var(--fg)}svg text{fill:var(--fg);font-family:inherit}';

/** roster figure setup: Archify を版を固定して取って置く。 */
export function figureSetup(ctx: Context): string[] {
  return setupArchify(ctx);
}

/** 図の名（JSON の file の名から。id と class の頭になる）。 */
export function figureName(jsonPath: string): string {
  const stem = basename(jsonPath).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `fig-${stem || 'x'}`;
}

/** Archify の export-svg の答え（--json）のうち、読む所。 */
interface ExportReply {
  ok?: boolean
  outputs?: { path?: string }[]
  diagnostics?: { code?: string, message?: string }[]
}

/** 図の JSON 1 つを描き、整えた SVG を返す。workflow は、縮める割合が決まるまで箱の幅を決め直す。 */
function renderFigure(ctx: Context, json: FigureJson, name: string, work: string): { svg: string, scale: number, rounds: number } {
  const type = json.diagram_type;
  if (typeof type !== 'string' || type === '') throw new TpmError(`図 ${name} の JSON に diagram_type がありません`);
  const version = archifyVersion(ctx.root);
  let scale = 1;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const input = join(work, `${name}.json`);
    writeFileSync(input, JSON.stringify(fitFigure(json, scale), null, 2));
    const r = runArchify(ctx, ['export-svg', type, input, join(work, name), '--theme', 'light', '--quality', 'standard', '--json']);
    let reply: ExportReply;
    try {
      reply = JSON.parse(r.stdout) as ExportReply;
    }
    catch {
      throw new TpmError(`図 ${name} を Archify で描けません: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}`);
    }
    if (reply.ok !== true) {
      const why = (reply.diagnostics ?? []).filter(d => d.code !== 'i18n/locale-fallback').map(d => `${d.code ?? ''}: ${(d.message ?? '').split('\n')[0] ?? ''}`);
      throw new TpmError([`図 ${name} を Archify で描けません（JSON を直してから打ち直す。直しは figure-fix の skill に任せられる）:`, ...why].join('\n'));
    }
    const path = reply.outputs?.[0]?.path;
    if (path === undefined || !existsSync(path)) throw new TpmError(`図 ${name} の SVG が出ませんでした`);
    const svg = readFileSync(path, 'utf8');
    const next = scaleOf(svg);
    if (type !== 'workflow' || Math.abs(next - scale) < 0.01) return { svg: tidySvg(svg, { prefix: name, version: version.tag }), scale: next, rounds: round };
    scale = next;
  }
  throw new TpmError(`図 ${name} は、字が長く、文書の幅（${PAGE_WIDTH}px）に 13px の字で収まりません。箱の字（label・sublabel）を短くしてください`);
}

/** roster figure embed のオプション。 */
export interface FigureEmbedOptions {
  /** 図を埋めた物を書く file（置く用）。 */
  out: string
}

/** roster figure embed: 書き手の file の目印ごとに図を描いて整え、埋めた物を置く用の file に出す（書き手の file は変えない）。 */
export function figureEmbed(ctx: Context, file: string, options: FigureEmbedOptions): string[] {
  const src = resolve(file);
  const out = resolve(options.out);
  if (out === src) throw new TpmError('--out に書き手の file と同じ path は書けません（書き手の file には目印だけを残す）');
  const text = readFileSync(src, 'utf8');
  const marks = [...text.matchAll(MARKER)];
  if (marks.length === 0) throw new TpmError(`${file} に図の目印（<!-- figure: <JSON の path> -->）がありません`);
  const work = mkdtempSync(join(tmpdir(), 'roster-figure-'));
  const lines: string[] = [];
  try {
    const done = new Map<string, string>();
    for (const m of marks) {
      const ref = m[1] ?? '';
      if (done.has(ref)) continue;
      const jsonPath = isAbsolute(ref) ? ref : join(dirname(src), ref);
      if (!existsSync(jsonPath)) throw new TpmError(`目印の JSON がありません: ${ref}（${jsonPath}）`);
      const name = figureName(jsonPath);
      const r = renderFigure(ctx, JSON.parse(readFileSync(jsonPath, 'utf8')) as FigureJson, name, work);
      done.set(ref, r.svg);
      lines.push(`図 ${name}: ${Buffer.byteLength(r.svg)} byte・縮める割合 ${r.scale.toFixed(2)}・${r.rounds} 回で決まった`);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text.replace(MARKER, (_m, ref: string) => done.get(ref) ?? ''));
  }
  finally {
    rmSync(work, { recursive: true, force: true });
  }
  return [...lines, `書いた: ${out}`];
}

/** roster figure shot のオプション。 */
export interface FigureShotOptions {
  /** png を書く folder（無ければ一時の folder を作る）。 */
  dir?: string
}

/** 文書の style（色の変数）を、明るい画面か暗い画面に決めた形にする。 */
function themed(style: string, theme: 'light' | 'dark'): string {
  return style.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g, theme === 'dark' ? '@media all' : '@media (max-width:1px)');
}

/**
 * roster figure shot: 置く用の file の、Archify で描いた図ごとに、寸法の検査をし、明るい・暗いの png（2 倍の細かさ）を撮る。
 * 寸法の検査で傷があれば、png を撮った上で止まる（終了コード 1）。png は figure-fix の skill（Haiku）が助言の検査に使う。
 */
export function figureShot(ctx: Context, file: string, options: FigureShotOptions = {}): string[] {
  const text = readFileSync(resolve(file), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? DEFAULT_STYLE;
  const svgs = [...text.matchAll(/<svg\b[^>]*data-fig="archify"[\s\S]*?<\/svg>/g)].map(m => m[0]);
  if (svgs.length === 0) throw new TpmError(`${file} に Archify で描いた図（data-fig="archify" の svg）がありません。先に roster figure embed を打つ`);
  const chrome = ctx.env.ROSTER_CHROME || DEFAULT_CHROME;
  const dir = options.dir === undefined ? mkdtempSync(join(tmpdir(), 'roster-figure-shot-')) : resolve(options.dir);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  let flawed = 0;
  for (const svg of svgs) {
    const name = /\bclass="([^"]+)"/.exec(svg)?.[1] ?? 'fig';
    const vb = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? `0 0 ${PAGE_WIDTH} 280`).split(/\s+/).map(Number);
    const shown = Math.min(PAGE_WIDTH, vb[2] ?? PAGE_WIDTH);
    const height = Math.ceil(shown * (vb[3] ?? 280) / (vb[2] ?? PAGE_WIDTH)) + 16;
    const page = (theme: 'light' | 'dark', script = ''): string => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${themed(style, theme)}body{margin:0;padding:8px;width:${PAGE_WIDTH}px}</style></head><body>${svg}${script === '' ? '' : `<script>${script}</script>`}</body></html>`;
    const base = ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(dir, '.chrome')}`];
    // 寸法の検査（明るい画面で。色は寸法に効かない）。
    const checkHtml = join(dir, `${name}.check.html`);
    writeFileSync(checkHtml, page('light', CHECK_SCRIPT));
    const dumped = ctx.exec(chrome, [...base, `--window-size=${PAGE_WIDTH + 16},${height}`, '--virtual-time-budget=2000', '--dump-dom', `file://${checkHtml}`]);
    const flaws = readFlaws(dumped.stdout);
    if (flaws === undefined) throw new TpmError(`図 ${name} の寸法の検査を読めません（Chrome: ${chrome}。在り処が違えば $ROSTER_CHROME に書く）: ${dumped.stderr.trim().split('\n')[0] ?? ''}`);
    flawed += flaws.length;
    lines.push(`図 ${name}: 寸法の検査 ${flaws.length} 件`, ...flaws.map(f => `  - ${flawLine(f)}`));
    for (const theme of ['light', 'dark'] as const) {
      const html = join(dir, `${name}.${theme}.html`);
      const png = join(dir, `${name}.${theme}.png`);
      writeFileSync(html, page(theme));
      const r = ctx.exec(chrome, [...base, '--force-device-scale-factor=2', `--window-size=${PAGE_WIDTH + 16},${height}`, `--screenshot=${png}`, `file://${html}`]);
      if (!existsSync(png)) throw new TpmError(`図 ${name} の ${theme} の png を撮れません: ${r.stderr.trim().split('\n')[0] ?? ''}`);
      lines.push(`  ${theme}: ${png}`);
    }
  }
  if (flawed > 0) throw new TpmError([...lines, `寸法の検査で ${flawed} 件の傷があります。JSON（箱の字を短くする・箱の位置を替える）を直して、roster figure embed から打ち直してください`].join('\n'));
  return lines;
}
