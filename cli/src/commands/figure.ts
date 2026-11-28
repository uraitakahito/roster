// roster figure …: 文書の図を Archify で描いて整える（setup・embed・shot）。手順と決まりは _shared/figures.md の「Archify で描く」。
// 書き手の file には目印（<!-- figure: <JSON の path> -->）だけを書き、embed が整えた SVG を埋めた物を別の file（置く用）に出す。
// 書き手（高い model）が SVG の字を書き写さず、文書を直す時も SVG が書き手の文脈に戻らないように。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromeArgs, DEFAULT_CHROME } from '../chrome.ts';
import type { Context } from '../context.ts';
import { archifyVersion, runArchify, setupArchify } from '../figure/archify.ts';
import { CHECK_SCRIPT, flawLine, readFlaws } from '../figure/check.ts';
import { fitFigure, PAGE_WIDTH, scaleOf, viewBoxOf, type FigureJson } from '../figure/fit.ts';
import { tidySvg } from '../figure/tidy.ts';
import { TpmError } from '../skill-sets.ts';

/** 目印の形（書き手の file に書く）。 */
export const MARKER = /<!--\s*figure:\s*(\S+?)\s*-->/g;
/** 箱の幅を決め直す回の上限。 */
const MAX_ROUNDS = 8;
/** これより小さく縮める図は、字が長すぎるとして止まる（映る字は大きいが、箱の外の線や余白が細かくなりすぎる）。 */
const MIN_SCALE = 0.3;
/** 文書に style が無い時の色の変数（_shared/figures.md の「色の変数」の写し。そちらを替えたら、ここも揃える）。 */
const DEFAULT_STYLE = ':root{--bg:#fff;--fg:#1f2328;--mute:#59636e;--line:#d1d9e0;--card:#f6f8fa;--a:#1f6feb;--ok:#1a7f37;--mid:#bf8700;--ng:#cf222e}@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#9198a1;--line:#3d444d;--card:#151b23;--a:#4493f8;--ok:#3fb950;--mid:#d29922;--ng:#f85149}}body{background:var(--bg);color:var(--fg)}svg text{fill:var(--fg);font-family:inherit}';

/** roster figure setup: Archify を版を固定して取って置く。 */
export function figureSetup(ctx: Context): string[] {
  return setupArchify(ctx);
}

/**
 * roster figure guide: Archify の guide（場面を一言で渡すと、勧める図の種類・入れる物・書き方の手がかりを返す）を打つ。
 * Archify の guide は、日本語の場面を中国語で答えるので、英語（--lang en）で答えさせる。
 */
export function figureGuide(ctx: Context, scenario: string): string[] {
  const r = runArchify(ctx, ['guide', scenario, '--lang', 'en']);
  if (r.status !== 0) throw new TpmError(`Archify の guide が落ちました（終了コード ${r.status}）: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}`);
  return [r.stdout.trimEnd()];
}

/** 図の名（JSON の file の名から。id と class の頭・shot の png の名になる）。英字の無い名は fig-x。 */
export function figureName(jsonPath: string): string {
  const stem = basename(jsonPath).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `fig-${stem || 'x'}`;
}

/** 1 つの文書の中で重ならない名にする（重なれば -2・-3 を足す）。 */
function uniqueName(name: string, used: Set<string>): string {
  let n = name;
  for (let i = 2; used.has(n); i++) n = `${name}-${i}`;
  used.add(n);
  return n;
}

/** Archify の診断 1 つ（--json の diagnostics）のうち、読む所。 */
export interface Diagnostic {
  code?: string
  severity?: string
  message?: string
  subject?: { path?: string }
  supportedFixes?: string[]
}

/** Archify の export-svg の答え（--json）のうち、読む所。 */
interface ExportReply {
  ok?: boolean
  outputs?: { path?: string }[]
  diagnostics?: Diagnostic[]
}

/** Archify が図を描けなかった（診断つき）。 */
class DrawFailed extends TpmError {
  /** Archify の診断。 */
  readonly diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[]) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

/** 直し方が箱の位置（`/nodes/<n>/col` など）を替える物か。位置でない直し（線の端・帯・字）は、図の意味を変える。 */
export function isPlacementFix(fix: string): boolean {
  return /^set \/nodes\/[0-9]+\/(col|row|x|y|order)\b/.test(fix);
}

/** 誤りの診断を、場所と直し方（[位置] を先に、3 つまで）の行にする。並べる診断が無ければ、そう 1 行書く。 */
export function diagnosticLines(diagnostics: Diagnostic[]): string[] {
  const errors = diagnostics.filter(d => d.severity === 'error' || (d.severity === undefined && d.code !== 'i18n/locale-fallback'));
  if (errors.length === 0) return ['- 誤りの診断が出なかった（Archify は描けないと答えた。JSON を見直す）'];
  const lines: string[] = [];
  for (const d of errors) {
    lines.push(`- ${d.code ?? ''}（${d.subject?.path ?? '場所なし'}）: ${(d.message ?? '').split('\n')[0] ?? ''}`);
    const fixes = [...(d.supportedFixes ?? [])].sort((a, b) => Number(isPlacementFix(b)) - Number(isPlacementFix(a)));
    if (fixes.length === 0) lines.push('  直し方: 無し（書き手が直す）');
    for (const fix of fixes.slice(0, 3)) lines.push(`  直し方: [${isPlacementFix(fix) ? '位置' : '意味'}] ${fix}`);
  }
  return lines;
}

/** 図の JSON を読む（無い・読めない時は、目印か path を名指して止まる）。 */
function readFigureJson(path: string, label: string): FigureJson {
  if (!existsSync(path)) throw new TpmError(`JSON がありません: ${label}（${path}）`);
  let json: FigureJson;
  try {
    json = JSON.parse(readFileSync(path, 'utf8')) as FigureJson;
  }
  catch (e) {
    throw new TpmError(`JSON を読めません: ${label}（${(e as Error).message}）`);
  }
  if (typeof json.diagram_type !== 'string' || json.diagram_type === '') throw new TpmError(`JSON に diagram_type がありません: ${label}`);
  return json;
}

/**
 * 図の JSON 1 つを描き、整えた SVG を返す。workflow は、見立てた割合 s で箱の幅を決めて描き、実の割合（760 ÷ 描く幅）が s 以上なら決まり
 * （箱は s の時の字が入る幅なので、実の割合の字も入る）。s より小さければ、s を下げて描き直す（次の s は割線法で求め、前の s より小さくする）。
 * Archify が描けなければ、診断つきの DrawFailed で止まる（validate も、この同じ形で検査する）。
 */
function renderFigure(ctx: Context, json: FigureJson, name: string, work: string): { svg: string, scale: number, rounds: number } {
  const type = json.diagram_type ?? '';
  const version = archifyVersion(ctx.root);
  let scale = 1;
  let prev: { scale: number, gap: number } | undefined;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const input = join(work, `${name}.json`);
    writeFileSync(input, JSON.stringify(fitFigure(json, scale), null, 2));
    const r = runArchify(ctx, ['export-svg', type, input, join(work, name), '--theme', 'light', '--quality', 'standard', '--json']);
    let reply: ExportReply;
    try {
      reply = JSON.parse(r.stdout) as ExportReply;
    }
    catch {
      throw new TpmError(`Archify の答えを読めません（終了コード ${r.status}）: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}`);
    }
    if (reply.ok !== true) {
      const diagnostics = reply.diagnostics ?? [];
      throw new DrawFailed(['Archify で描けません（JSON を直してから打ち直す）:', ...diagnosticLines(diagnostics)].join('\n'), diagnostics);
    }
    const path = reply.outputs?.[0]?.path;
    if (path === undefined || !existsSync(path)) throw new TpmError('Archify の SVG が出ませんでした');
    const svg = readFileSync(path, 'utf8');
    const next = scaleOf(svg);
    if (type !== 'workflow' && next < 1) throw new TpmError(`${type} の図は、Archify の描く幅が ${viewBoxOf(svg)[2] ?? '?'} で文書の幅（${PAGE_WIDTH}px）を超え、字が箱に収まりません（箱の幅を合わせるのは workflow だけ）。箱を減らすか、workflow で描いてください`);
    if (type !== 'workflow' || next >= scale - 0.005) return { svg: tidySvg(svg, { prefix: name, version: version.tag }), scale: next, rounds: round };
    // 実の割合と見立ての差（負）を 0 にする s を、前の回との割線で見立てる。前の回が無ければ、実の割合に下げる。
    const gap = next - scale;
    const secant = prev === undefined || gap === prev.gap ? next : scale - gap * (scale - prev.scale) / (gap - prev.gap);
    prev = { scale, gap };
    scale = Math.min(scale - 0.01, Math.max(secant, scale * 0.5));
    if (scale < MIN_SCALE) break;
  }
  throw new TpmError(`字が長く、文書の幅（${PAGE_WIDTH}px）に 13px の字で収まりません。箱の字（label・sublabel）を短くするか、箱を減らしてください`);
}

/**
 * roster figure validate: 図の JSON 1 つを、embed と同じ形（standard・凡例を消す・割合が決まるまで箱の幅と高さを決め直す）で Archify に描かせて検査する。
 * 通れば 1 行。描けなければ、誤りの診断ごとに、JSON の場所と、直し方（[位置] は箱の位置の直し、[意味] は図の意味を変える直し）を並べて止まる。
 */
export function figureValidate(ctx: Context, file: string): string[] {
  const path = resolve(file);
  const json = readFigureJson(path, path);
  const work = mkdtempSync(join(tmpdir(), 'roster-figure-'));
  try {
    const r = renderFigure(ctx, json, figureName(path), work);
    return [`通った: ${path}（縮める割合 ${r.scale.toFixed(2)}）`];
  }
  catch (e) {
    if (e instanceof DrawFailed) throw new TpmError([`落ちた: ${path}`, ...diagnosticLines(e.diagnostics)].join('\n'));
    if (e instanceof TpmError) throw new TpmError(`落ちた: ${path}\n- ${e.message}\n  直し方: 無し（書き手が直す）`);
    throw e;
  }
  finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** roster figure embed のオプション。 */
export interface FigureEmbedOptions {
  /** 図を埋めた物を書く file（置く用）。 */
  out: string
  /** 名指した図（JSON の path）。ほかの図が描けなくても、この図が埋まれば通る（ほかの図の訳は並べる）。 */
  figure?: string
}

/** 図の JSON の印（symlink を解いた path の hash の頭 12 字）。置く用の file の図の根に書き、shot が図を名指すのに使う（path そのものは書かない。置くページに機械の path を載せないため）。 */
export function figureId(jsonPath: string): string {
  const path = existsSync(jsonPath) ? realpathSync(jsonPath) : resolve(jsonPath);
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
}

/**
 * roster figure embed: 書き手の file の目印ごとに図を描いて整え、埋めた物を置く用の file に出す（書き手の file は変えない）。
 * 描けない図があっても、ほかの図は埋めて書き、描けない図の目印は残して、図ごとの訳を並べる。--figure が無ければ、描けない図があれば止まる。
 * --figure があれば、その図が描けない時だけ止まり、ほかの図だけが描けない時は通る（置く用の file にその図が欠けていることを書く）。
 * 埋めた図の根には、JSON の印（data-src。figureId）を書く（shot が図を名指すため）。
 */
export function figureEmbed(ctx: Context, file: string, options: FigureEmbedOptions): string[] {
  const src = resolve(file);
  const out = resolve(options.out);
  if (out === src) throw new TpmError('--out に書き手の file と同じ path は書けません（書き手の file には目印だけを残す）');
  if (!existsSync(src)) throw new TpmError(`file がありません: ${src}`);
  const text = readFileSync(src, 'utf8');
  const marks = [...text.matchAll(MARKER)];
  if (marks.length === 0) throw new TpmError(`${file} に図の目印（<!-- figure: <JSON の path> -->）がありません`);
  const pathOf = (ref: string): string => resolve(isAbsolute(ref) ? ref : join(dirname(src), ref));
  const seen = new Set<string>();
  for (const m of marks) {
    const ref = m[1] ?? '';
    if (seen.has(pathOf(ref))) throw new TpmError(`同じ図の目印が 2 つあります: ${ref}（1 つの図は 1 か所に置く。2 か所に要るなら JSON を写して別の名にする）`);
    seen.add(pathOf(ref));
  }
  const target = options.figure === undefined ? undefined : resolve(options.figure);
  if (target !== undefined && ![...seen].some(p => figureId(p) === figureId(target))) throw new TpmError(`${file} に、--figure の図の目印がありません: ${options.figure}`);
  const work = mkdtempSync(join(tmpdir(), 'roster-figure-'));
  const lines: string[] = [];
  const failed: { path: string, line: string }[] = [];
  const done = new Map<string, string>();
  try {
    const used = new Set<string>();
    for (const m of marks) {
      const ref = m[1] ?? '';
      const jsonPath = pathOf(ref);
      const name = uniqueName(figureName(jsonPath), used);
      try {
        const r = renderFigure(ctx, readFigureJson(jsonPath, ref), name, work);
        const svg = r.svg.replace('data-fig="archify"', `data-fig="archify" data-src="${figureId(jsonPath)}"`);
        done.set(jsonPath, svg);
        lines.push(`図 ${name}（${ref}）: ${Buffer.byteLength(svg)} byte・縮める割合 ${r.scale.toFixed(2)}・${r.rounds} 回で決まった`);
      }
      catch (e) {
        if (!(e instanceof TpmError)) throw e;
        failed.push({ path: jsonPath, line: `図 ${name}（${ref}）を埋められません: ${e.message}` });
      }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text.replace(MARKER, (m: string, ref: string) => done.get(pathOf(ref)) ?? m));
  }
  finally {
    rmSync(work, { recursive: true, force: true });
  }
  const wrote = `書いた: ${out}（図 ${marks.length} つのうち ${done.size} つを埋めた）`;
  if (target === undefined) {
    if (failed.length > 0) throw new TpmError([...lines, ...failed.map(f => f.line), `${wrote}。埋められなかった図の目印は残した。JSON を直してから打ち直す`].join('\n'));
    return [...lines, wrote];
  }
  const mine = failed.find(f => figureId(f.path) === figureId(target));
  const others = failed.filter(f => figureId(f.path) !== figureId(target)).map(f => `ほかの図: ${f.line}（置く用の file には、この図が欠けている。置く前に直す）`);
  if (mine !== undefined) throw new TpmError([mine.line, ...others, wrote].join('\n'));
  return [...lines.filter(l => !l.includes('を埋められません')), ...others, wrote];
}

/** roster figure shot のオプション。 */
export interface FigureShotOptions {
  /** png を書く folder（無ければ一時の folder を作る）。 */
  dir?: string
  /** 名指した図（JSON の path）。この図だけを検査して撮る。 */
  figure?: string
}

/** 文書の style（色の変数）を、明るい画面か暗い画面に決めた形にする。 */
function themed(style: string, theme: 'light' | 'dark'): string {
  return style.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g, theme === 'dark' ? '@media all' : '@media (max-width:1px)');
}

/**
 * roster figure shot: 置く用の file の、Archify で描いた図ごとに、寸法の検査をし、明るい・暗いの png（2 倍の細かさ）を撮る。
 * --figure があれば、その図だけ。寸法の検査で傷があれば、png を撮った上で止まる（終了コード 1）。png は figure-fix の skill（Haiku）が助言の検査に使う。
 */
export function figureShot(ctx: Context, file: string, options: FigureShotOptions = {}): string[] {
  const path = resolve(file);
  if (!existsSync(path)) throw new TpmError(`file がありません: ${path}`);
  const text = readFileSync(path, 'utf8');
  // 文書の色の変数は、最初の図より前の <style>（図の中の style は図ごとの物なので使わない）。
  const style = /<style>([\s\S]*?)<\/style>/.exec(text.slice(0, Math.max(0, text.search(/<svg\b/))))?.[1] ?? DEFAULT_STYLE;
  const all = [...text.matchAll(/<svg\b[^>]*data-fig="archify"[\s\S]*?<\/svg>/g)].map(m => m[0]);
  if (all.length === 0) throw new TpmError(`${file} に Archify で描いた図（data-fig="archify" の svg）がありません。先に roster figure embed を打つ`);
  const srcOf = (svg: string): string => /\bdata-src="([^"]*)"/.exec(/<svg\b[^>]*>/.exec(svg)?.[0] ?? '')?.[1] ?? '';
  const target = options.figure === undefined ? undefined : figureId(resolve(options.figure));
  const svgs = target === undefined ? all : all.filter(svg => srcOf(svg) === target);
  if (svgs.length === 0) throw new TpmError(`${file} に、--figure の図がありません（roster figure embed で埋められていない）: ${options.figure ?? ''}`);
  const chrome = ctx.env.ROSTER_CHROME || DEFAULT_CHROME;
  const dir = options.dir === undefined ? mkdtempSync(join(tmpdir(), 'roster-figure-shot-')) : resolve(options.dir);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  let flawed = 0;
  const shotNames = new Set<string>();
  for (const svg of svgs) {
    const name = uniqueName(/\bclass="([^"]+)"/.exec(svg)?.[1] ?? 'fig', shotNames);
    const label = options.figure === undefined ? name : `${name}（${options.figure}）`;
    const box = viewBoxOf(svg);
    const vb = box.length === 4 ? box : [0, 0, PAGE_WIDTH, 280];
    const shown = Math.min(PAGE_WIDTH, vb[2] ?? PAGE_WIDTH);
    const height = Math.ceil(shown * (vb[3] ?? 280) / (vb[2] ?? PAGE_WIDTH)) + 16;
    const page = (theme: 'light' | 'dark', script = ''): string => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${themed(style, theme)}body{margin:0;padding:8px;width:${PAGE_WIDTH}px}</style></head><body>${svg}${script === '' ? '' : `<script>${script}</script>`}</body></html>`;
    // 旗の組みは roster chrome と同じ（keychain を読ませない旗・headless・profile。src/chrome.ts）。
    const base = chromeArgs({ args: ['--disable-gpu', '--hide-scrollbars'], profile: join(dir, '.chrome') });
    // 寸法の検査（明るい画面で。色は寸法に効かない）。
    const checkHtml = join(dir, `${name}.check.html`);
    writeFileSync(checkHtml, page('light', CHECK_SCRIPT));
    const dumped = ctx.exec(chrome, [...base, `--window-size=${PAGE_WIDTH + 16},${height}`, '--virtual-time-budget=2000', '--dump-dom', pathToFileURL(checkHtml).href]);
    const flaws = readFlaws(dumped.stdout);
    if (flaws === undefined) throw new TpmError(`図 ${label} の寸法の検査を読めません（Chrome: ${chrome}。在り処が違えば $ROSTER_CHROME に書く）: ${dumped.stderr.trim().split('\n')[0] ?? ''}`);
    flawed += flaws.length;
    lines.push(`図 ${label}: 寸法の検査 ${flaws.length} 件`, ...flaws.map(f => `  - ${flawLine(f)}`));
    for (const theme of ['light', 'dark'] as const) {
      const html = join(dir, `${name}.${theme}.html`);
      const png = join(dir, `${name}.${theme}.png`);
      writeFileSync(html, page(theme));
      const r = ctx.exec(chrome, [...base, '--force-device-scale-factor=2', `--window-size=${PAGE_WIDTH + 16},${height}`, `--screenshot=${png}`, pathToFileURL(html).href]);
      if (!existsSync(png)) throw new TpmError(`図 ${label} の ${theme} の png を撮れません: ${r.stderr.trim().split('\n')[0] ?? ''}`);
      lines.push(`  ${theme}: ${png}`);
    }
  }
  if (flawed > 0) throw new TpmError([...lines, `寸法の検査で ${flawed} 件の傷があります。JSON（箱の字を短くする・箱の位置を替える・箱を減らす）を直して、roster figure embed から打ち直してください`].join('\n'));
  return lines;
}
