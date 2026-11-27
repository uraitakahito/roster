import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { figureEmbed, figureName, figureShot, figureSetup } from '../src/commands/figure.ts';
import type { Context } from '../src/context.ts';
import type { Exec, ExecResult } from '../src/exec.ts';
import { archifyBin, archifyHome, archifyVersion } from '../src/figure/archify.ts';
import { flawLine, readFlaws } from '../src/figure/check.ts';
import { fitFigure, scaleOf, textWidth } from '../src/figure/fit.ts';
import { tidySvg } from '../src/figure/tidy.ts';
import { world } from './helpers.ts';

/** Archify v3.3.2 が出した workflow の SVG（明るい用）。埋め込みの字形・CSS・NOTICE の文は、試験のため短い置き字に縮めてある。 */
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'archify', 'workflow-light.svg'), 'utf8');

/** 一時の folder。 */
const temp = (name: string): string => realpathSync(mkdtempSync(join(tmpdir(), `roster-figure-${name}-`)));

/** 偽の命令を入れた周り。XDG_DATA_HOME を一時の folder にし、置いた Archify の入口（中身は空）を置くかを選ぶ。 */
function setup(fake: Exec, options: { placed?: boolean } = {}): { ctx: Context, data: string } {
  const data = temp('data');
  const w = world();
  const ctx: Context = { ...w.tpm, exec: fake, env: { ...w.tpm.env, XDG_DATA_HOME: data } };
  if (options.placed !== false) {
    const bin = archifyBin(ctx.env, archifyVersion(ctx.root));
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '');
  }
  return { ctx, data };
}

const ok = (stdout = ''): ExecResult => ({ status: 0, stdout, stderr: '' });

/** Archify の export-svg の偽物: <stem>.svg に svg を書き、--json の答えを返す。打った回の JSON を集める。 */
function fakeArchify(svgOf: (json: Record<string, unknown>, round: number) => string, seen: Record<string, unknown>[] = []): Exec {
  return (cmd, args) => {
    if (cmd !== 'env') return ok();
    const at = args.indexOf('export-svg');
    const input = args[at + 2] ?? '';
    const stem = args[at + 3] ?? '';
    const json = JSON.parse(readFileSync(input, 'utf8')) as Record<string, unknown>;
    seen.push(json);
    writeFileSync(`${stem}.svg`, svgOf(json, seen.length));
    return ok(JSON.stringify({ ok: true, outputs: [{ path: `${stem}.svg` }] }));
  };
}

describe('箱の幅（fit）', () => {
  test('字の幅は、日本語 1 字・英大文字と数字 0.65 字・ほか 0.55 字・空白 0.3 字', () => {
    expect(textWidth('図を', 10)).toBe(20);
    expect(textWidth('A1', 10)).toBe(13);
    expect(textWidth('ab c', 10)).toBeCloseTo(19.5);
  });

  test('workflow は、縮める割合で映る字が入る幅を箱に書く。standard・凡例を消す・viewBox と locale は外す。元は変えない', () => {
    const json = { diagram_type: 'workflow', meta: { title: 't', viewBox: [760, 280], locale: 'ja', quality_profile: 'showcase' }, nodes: [{ label: '検査と直し', sublabel: 'validate' }, { label: 'a' }] };
    const fitted = fitFigure(json, 0.5);
    expect(fitted.meta).toEqual({ title: 't', quality_profile: 'standard', legend: { mode: 'hidden' } });
    // 「検査と直し」は 5 字 × 26px = 130 に余白 48。
    expect(fitted.nodes?.map(n => n.width)).toEqual([178, 92]);
    expect(json.nodes[0]).not.toHaveProperty('width');
    expect(json.meta.viewBox).toEqual([760, 280]);
  });

  test('workflow でない図は箱の幅を書かない', () => {
    expect(fitFigure({ diagram_type: 'lifecycle', states: [{ label: 'x' }] }, 1)).toEqual({ diagram_type: 'lifecycle', meta: { quality_profile: 'standard', legend: { mode: 'hidden' } }, states: [{ label: 'x' }] });
  });

  test('縮める割合は、描く幅が 760 を超えた分だけ（1 より大きくしない）', () => {
    expect(scaleOf('<svg viewBox="0 0 1520 300">')).toBe(0.5);
    expect(scaleOf('<svg viewBox="0 0 500 300">')).toBe(1);
  });
});

describe('SVG を整える（tidy）', () => {
  const out = tidySvg(FIXTURE, { prefix: 'fig-a', version: 'v3.3.2' });

  test('字形・Archify の CSS・metadata・icon・背景を外し、作図の注を 1 行残す', () => {
    expect(out).not.toMatch(/font-face|data:font|<metadata|NOTICE|data-semantic-sigil|archify-bake-background|#eaf6f2/);
    expect(out).toContain('<!-- 作図: Archify v3.3.2（Apache-2.0） -->');
    expect(out.match(/<style>/g)).toHaveLength(1);
  });

  test('根の svg: 幅 100%・760 まで・lang="ja"・role="img"・題を aria-label に・data-fig と図ごとの class', () => {
    const root = /<svg\b[^>]*>/.exec(out)?.[0] ?? '';
    expect(root).toContain('viewBox="0 0 805 316"');
    expect(root).toContain('width="100%"');
    expect(root).toContain('style="max-width:760px"');
    expect(root).toContain('lang="ja"');
    expect(root).toContain('role="img"');
    expect(root).toContain('aria-label="図を作る流れ"');
    expect(root).toContain('data-fig="archify"');
    expect(root).toContain('class="fig-a"');
  });

  test('色は文書の色の変数だけ（図ごとの class で閉じる）', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(out)?.[1] ?? '';
    expect(style).toContain('.fig-a .t-primary{fill:var(--fg)}');
    expect(style).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  test('字は縮めた後に 13px・10px で映る大きさ（805 → 760 なので 13.8・10.6）', () => {
    expect([...new Set([...out.matchAll(/font-size="([0-9.]+)"/g)].map(m => m[1]))].sort()).toEqual(['10.6', '13.8']);
  });

  test('id には図ごとの頭が付き、url(#…) の参照はみな在る id を指す。2 つの図で id が重ならない', () => {
    const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map(m => m[1] ?? '');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every(id => id.startsWith('fig-a-'))).toBe(true);
    for (const ref of out.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1]);
    const other = tidySvg(FIXTURE, { prefix: 'fig-b', version: 'v3.3.2' });
    const otherIds = [...other.matchAll(/\sid="([^"]+)"/g)].map(m => m[1] ?? '');
    expect(otherIds.filter(id => ids.includes(id))).toEqual([]);
  });

  test('対話の印（tabindex・role="button"・aria-label="Focus …"）を外す', () => {
    expect(out).not.toMatch(/tabindex|role="button"|aria-label="Focus /);
  });

  test('箱の中の字を、箱の上下の中ほどに並べ直す', () => {
    const group = /<g [^>]*data-node-id="val"[^>]*>[\s\S]*?<\/g>/.exec(out)?.[0] ?? '';
    const rect = /<rect [^>]*?y="([-0-9.]+)"[^>]*?height="([0-9.]+)"/.exec(group);
    const ys = [...group.matchAll(/<text [^>]*?y="([-0-9.]+)"/g)].map(m => Number(m[1]));
    const mid = Number(rect?.[1]) + Number(rect?.[2]) / 2;
    expect(ys).toHaveLength(2);
    expect(Math.abs((ys[0] ?? 0) + (ys[1] ?? 0) - 2 * mid)).toBeLessThan(14);
  });

  test('図の頭に使えない字は断る', () => {
    expect(() => tidySvg(FIXTURE, { prefix: 'Fig A', version: 'v3.3.2' })).toThrow('図の頭');
  });
});

describe('寸法の検査の結果を読む', () => {
  test('--dump-dom の pre から JSON を読み、1 行にする', () => {
    const flaws = readFlaws('<body><pre id="roster-figure-check">[{&quot;kind&quot;:&quot;はみ出し&quot;,&quot;text&quot;:&quot;a &amp; b&quot;,&quot;node&quot;:&quot;x&quot;}]</pre></body>');
    expect(flaws).toEqual([{ kind: 'はみ出し', text: 'a & b', node: 'x' }]);
    expect(flawLine({ kind: '小さい字', text: 'z', px: 8.1 })).toBe('小さい字: z（8.1px）');
    expect(readFlaws('<body></body>')).toBeUndefined();
  });
});

describe('roster figure setup', () => {
  test('tag を浅く取り、archify/ だけを取り出し、commit が印と同じなら rename で置く。2 度目は取りに行かない', () => {
    const calls: string[][] = [];
    let commit = '';
    const fake: Exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'clone') mkdirSync(join(args.at(-1) ?? '', 'archify', 'bin'), { recursive: true });
      if (args[1] && args[2] === 'sparse-checkout') writeFileSync(join(args[1], 'archify', 'bin', 'archify.mjs'), '');
      return ok(args.includes('rev-parse') ? `${commit}\n` : '');
    };
    const { ctx } = setup(fake, { placed: false });
    commit = archifyVersion(ctx.root).commit;
    expect(figureSetup(ctx)[0]).toMatch(/^置いた: Archify v/);
    expect(calls[0]?.slice(0, 8)).toEqual(['git', 'clone', '--quiet', '--depth', '1', '--branch', archifyVersion(ctx.root).tag, '--filter=blob:none']);
    expect(existsSync(archifyBin(ctx.env, archifyVersion(ctx.root)))).toBe(true);
    calls.length = 0;
    expect(figureSetup(ctx)[0]).toMatch(/^置いてある: /);
    expect(calls).toEqual([]);
  });

  test('取った commit が印と違えば、置かずに止まる（一時の folder も消す）', () => {
    const fake: Exec = (_cmd, args) => {
      if (args[0] === 'clone') mkdirSync(join(args.at(-1) ?? '', 'archify', 'bin'), { recursive: true });
      return ok(args.includes('rev-parse') ? `${'0'.repeat(40)}\n` : '');
    };
    const { ctx } = setup(fake, { placed: false });
    expect(() => figureSetup(ctx)).toThrow(/commit が .archify-version と違います/);
    const home = archifyHome(ctx.env, archifyVersion(ctx.root));
    expect(existsSync(home)).toBe(false);
  });
});

describe('roster figure embed', () => {
  /** 書き手の file（目印 1 つ）と JSON を一時の folder に書く。 */
  function writer(json: Record<string, unknown> = { diagram_type: 'workflow', meta: { title: '図を作る流れ' }, nodes: [{ label: '検査と直し' }] }): { dir: string, file: string } {
    const dir = temp('embed');
    writeFileSync(join(dir, 'flow.json'), JSON.stringify(json));
    writeFileSync(join(dir, 'page.html'), '<p>前</p><figure><!-- figure: flow.json --><figcaption>図 1</figcaption></figure><p>後</p>');
    return { dir, file: join(dir, 'page.html') };
  }

  test('目印を整えた SVG に替えた物を --out に書く。書き手の file は変えない。箱の幅は縮める割合が決まるまで決め直す', () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup(fakeArchify(() => FIXTURE, seen));
    const { dir, file } = writer();
    const before = readFileSync(file, 'utf8');
    const lines = figureEmbed(ctx, file, { out: join(dir, 'out.html') });
    expect(lines[0]).toMatch(/^図 fig-flow: [0-9]+ byte・縮める割合 0\.94・2 回で決まった$/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const out = readFileSync(join(dir, 'out.html'), 'utf8');
    expect(out).toMatch(/^<p>前<\/p><figure><svg [^>]*class="fig-flow"[\s\S]*<\/svg><figcaption>図 1<\/figcaption><\/figure><p>後<\/p>$/);
    // 1 回目は縮めずに、2 回目は 805 → 760 の割合で箱の幅を決めた。
    expect(seen.map(j => (j.nodes as { width: number }[])[0]?.width)).toEqual([113, 117]);
    expect(seen[0]?.meta).toMatchObject({ quality_profile: 'standard' });
  });

  test('Archify が描けない JSON は、診断を並べて止まる（置く用の file を書かない）', () => {
    const fake: Exec = cmd => cmd === 'env' ? ok(JSON.stringify({ ok: false, diagnostics: [{ code: 'i18n/locale-fallback', message: 'x' }, { code: 'workflow/node-overlap', message: 'Node overlaps\nmore' }] })) : ok();
    const { ctx } = setup(fake);
    const { dir, file } = writer();
    expect(() => figureEmbed(ctx, file, { out: join(dir, 'out.html') })).toThrow(/描けません[\s\S]*workflow\/node-overlap: Node overlaps$/);
    expect(existsSync(join(dir, 'out.html'))).toBe(false);
  });

  test('縮める割合が決まらない図（字が長すぎる）は、字を短くするよう言って止まる', () => {
    const { ctx } = setup(fakeArchify((_json, round) => `<svg viewBox="0 0 ${800 + round * 300} 300"><title id="t">x</title></svg>`));
    const { dir, file } = writer();
    expect(() => figureEmbed(ctx, file, { out: join(dir, 'out.html') })).toThrow(/字が長く、文書の幅（760px）に 13px の字で収まりません/);
  });

  test('目印が無い・JSON が無い・--out が書き手の file と同じ・Archify が置かれていない時は止まる', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const { dir, file } = writer();
    writeFileSync(join(dir, 'none.html'), '<p>図なし</p>');
    expect(() => figureEmbed(ctx, join(dir, 'none.html'), { out: join(dir, 'o.html') })).toThrow('目印');
    writeFileSync(join(dir, 'lost.html'), '<!-- figure: lost.json -->');
    expect(() => figureEmbed(ctx, join(dir, 'lost.html'), { out: join(dir, 'o.html') })).toThrow('目印の JSON がありません: lost.json');
    expect(() => figureEmbed(ctx, file, { out: file })).toThrow('同じ path');
    const bare = setup(fakeArchify(() => FIXTURE), { placed: false });
    expect(() => figureEmbed(bare.ctx, file, { out: join(dir, 'o.html') })).toThrow('roster figure setup を打ってから');
  });

  test('図の名は JSON の file の名から（英小文字・数字・-）', () => {
    expect(figureName('/x/Review Flow.json')).toBe('fig-review-flow');
    expect(figureName('/x/図.json')).toBe('fig-x');
  });
});

describe('roster figure shot', () => {
  /** Chrome の偽物: --dump-dom には傷を返し、--screenshot= には png を書く。渡された HTML を集める。 */
  function fakeChrome(flaws: unknown[]): { exec: Exec, pages: string[] } {
    const pages: string[] = [];
    const exec: Exec = (_cmd, args) => {
      const url = args.at(-1) ?? '';
      pages.push(readFileSync(url.replace('file://', ''), 'utf8'));
      const shot = args.find(a => a.startsWith('--screenshot='));
      if (shot !== undefined) writeFileSync(shot.slice('--screenshot='.length), 'png');
      return ok(args.includes('--dump-dom') ? `<body><pre id="roster-figure-check">${JSON.stringify(flaws).replaceAll('"', '&quot;')}</pre></body>` : '');
    };
    return { exec, pages };
  }
  const page = `<html><head><style>:root{--fg:#000}@media (prefers-color-scheme: dark){:root{--fg:#fff}}</style></head><body>${tidySvg(FIXTURE, { prefix: 'fig-a', version: 'v3.3.2' })}</body></html>`;

  test('図ごとに寸法の検査をし、明るい・暗いの png（2 倍）を撮る。傷が無ければ通る', () => {
    const chrome = fakeChrome([]);
    const { ctx } = setup(chrome.exec);
    const dir = temp('shot');
    writeFileSync(join(dir, 'out.html'), page);
    const lines = figureShot(ctx, join(dir, 'out.html'), { dir: join(dir, 'png') });
    expect(lines).toEqual(['図 fig-a: 寸法の検査 0 件', `  light: ${join(dir, 'png', 'fig-a.light.png')}`, `  dark: ${join(dir, 'png', 'fig-a.dark.png')}`]);
    expect(chrome.pages[0]).toContain('roster-figure-check');
    expect(chrome.pages[1]).toContain('@media (max-width:1px)');
    expect(chrome.pages[2]).toContain('@media all');
  });

  test('寸法の検査で傷があれば、png を撮った上で、傷を並べて止まる', () => {
    const chrome = fakeChrome([{ kind: 'はみ出し', text: '検査と直し', node: 'val' }]);
    const { ctx } = setup(chrome.exec);
    const dir = temp('shot');
    writeFileSync(join(dir, 'out.html'), page);
    expect(() => figureShot(ctx, join(dir, 'out.html'), { dir: join(dir, 'png') })).toThrow(/寸法の検査 1 件\n {2}- はみ出し: 検査と直し（箱 val）[\s\S]*1 件の傷があります/);
    expect(existsSync(join(dir, 'png', 'fig-a.dark.png'))).toBe(true);
  });

  test('Archify で描いた図が無ければ、embed を先に打つよう言って止まる', () => {
    const { ctx } = setup(fakeChrome([]).exec);
    const dir = temp('shot');
    writeFileSync(join(dir, 'out.html'), '<p>x</p>');
    expect(() => figureShot(ctx, join(dir, 'out.html'))).toThrow('先に roster figure embed');
  });
});
