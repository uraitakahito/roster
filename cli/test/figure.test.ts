import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { figureEmbed, figureId, figureName, figureShot, figureSetup, figureValidate, isPlacementFix } from '../src/commands/figure.ts';
import type { Context } from '../src/context.ts';
import type { Exec, ExecResult } from '../src/exec.ts';
import { archifyBin, archifyHome, archifyVersion } from '../src/figure/archify.ts';
import { flawLine, readFlaws } from '../src/figure/check.ts';
import { fitFigure, scaleOf, textWidth, viewBoxOf } from '../src/figure/fit.ts';
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

  test('workflow は、縮める割合で映る字が入る幅と高さを箱に書く。standard・凡例を消す・viewBox と locale は外す。元は変えない', () => {
    const json = { diagram_type: 'workflow', meta: { title: 't', viewBox: [760, 280], locale: 'ja', quality_profile: 'showcase' }, nodes: [{ label: '検査と直し', sublabel: 'validate' }, { label: 'a' }] };
    const fitted = fitFigure(json, 0.5);
    expect(fitted.meta).toEqual({ title: 't', quality_profile: 'standard', legend: { mode: 'hidden' } });
    // 幅: 「検査と直し」は 5 字 × 13px = 65 に余白 48 を足し、割合 0.5 で 226。「a」は 0.55 × 13 + 48 = 55.2 で 111。
    expect(fitted.nodes?.map(n => n.width)).toEqual([226, 111]);
    // 高さ: 2 行は (13 + 10) × 1.25 + 13 × 0.35 + 上下の余白 18 = 51.3 で 103。1 行は 13 × 1.25 + 18 = 34.25 で 69。
    expect(fitted.nodes?.map(n => n.height)).toEqual([103, 69]);
    // 縮めない図でも、Archify の既定（幅 92・高さ 52）より小さくしない。
    expect(fitFigure(json, 1).nodes?.map(n => [n.width, n.height])).toEqual([[113, 52], [92, 52]]);
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

  test('線の字の地は、大きくした字が入る幅まで広げる', () => {
    for (const g of out.matchAll(/<g [^>]*data-edge-label="([^"]*)"[^>]*>(?:(?!<g\b)[\s\S])*?<\/g>/g)) {
      const w = Number(/<rect [^>]*width="([0-9.]+)"/.exec(g[0])?.[1]);
      const fs = Number(/font-size="([0-9.]+)"/.exec(g[0])?.[1]);
      expect(w).toBeGreaterThanOrEqual(textWidth(g[1] ?? '', fs));
    }
  });

  test('題の " を逃がし、viewBox の , 区切りも読む', () => {
    const src = FIXTURE.replace(/<title id="([^"]*)">[^<]*<\/title>/, '<title id="$1">「a" &amp; b」</title>').replace(/viewBox="0 0 805 316"/, 'viewBox="0,0,805,316"');
    const t = tidySvg(src, { prefix: 'fig-q', version: 'v3.3.2' });
    expect(t).toContain('aria-label="「a&quot; &amp; b」"');
    expect(t).toContain('style="max-width:760px"');
    expect(t).toContain('font-size="13.8"');
    expect(viewBoxOf('<svg viewBox=" 0, 0 ,805, 316 ">')).toEqual([0, 0, 805, 316]);
  });

  test('字の無い箱があっても、次の箱の字を動かさない。data-edge-id は替えず、href="#…" は替える', () => {
    const src = '<svg viewBox="0 0 400 200"><title id="t">x</title><defs><path id="p"/></defs><use href="#p"/>'
      + '<g id="node-a" data-node-id="a"><rect x="0" y="0" width="90" height="50"/></g>'
      + '<g id="node-b" data-node-id="b" data-edge-id="p"><rect x="0" y="100" width="90" height="50"/><text x="45" y="110" font-size="11">b</text></g></svg>';
    const t = tidySvg(src, { prefix: 'fig-n', version: 'v' });
    const y = Number(/<text [^>]*y="([-0-9.]+)"/.exec(t)?.[1]);
    expect(y).toBeGreaterThan(100);
    expect(y).toBeLessThan(150);
    expect(t).toContain('data-edge-id="p"');
    expect(t).toContain('href="#fig-n-p"');
    expect(t).toContain('id="fig-n-node-a"');
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

describe('roster figure setup の片付け', () => {
  /** clone で入口を作り、rev-parse で印の commit を返す git の偽物。onRevParse で、取りの途中の出来事を起こせる。 */
  function fakeGit(commit: () => string, onRevParse: () => void = () => undefined): Exec {
    return (_cmd, args) => {
      if (args[0] === 'clone') mkdirSync(join(args.at(-1) ?? '', 'archify', 'bin'), { recursive: true });
      if (args[1] && args[2] === 'sparse-checkout') writeFileSync(join(args[1], 'archify', 'bin', 'archify.mjs'), '');
      if (args.includes('rev-parse')) onRevParse();
      return ok(args.includes('rev-parse') ? `${commit()}\n` : '');
    };
  }

  test('前の setup が残した 1 時間より前の一時の folder を消す（新しい物は消さない）', () => {
    let commit = '';
    const { ctx } = setup(fakeGit(() => commit), { placed: false });
    const version = archifyVersion(ctx.root);
    commit = version.commit;
    const parent = join(archifyHome(ctx.env, version), '..');
    mkdirSync(join(parent, '.tmp-old'), { recursive: true });
    mkdirSync(join(parent, '.tmp-new'), { recursive: true });
    const hours = (h: number): Date => new Date(ctx.now().getTime() - h * 3600 * 1000);
    utimesSync(join(parent, '.tmp-old'), hours(2), hours(2));
    utimesSync(join(parent, '.tmp-new'), hours(0.5), hours(0.5));
    figureSetup(ctx);
    expect(readdirSync(parent).filter(n => n.startsWith('.tmp-'))).toEqual(['.tmp-new']);
  });

  test('入口の無い folder が置き場にあれば、取りに行かず、消す folder を名指して止まる', () => {
    const calls: string[] = [];
    const { ctx } = setup((cmd) => {
      calls.push(cmd);
      return ok();
    }, { placed: false });
    const home = archifyHome(ctx.env, archifyVersion(ctx.root));
    mkdirSync(join(home, 'archify'), { recursive: true });
    expect(() => figureSetup(ctx)).toThrow(`${home} はあるのに Archify の入口`);
    expect(calls).toEqual([]);
  });

  test('取っている間にほかの席が置いたら、その物を使う（自分の取った物は消す）', () => {
    let commit = '';
    const ref: { ctx?: Context } = {};
    const { ctx } = setup(fakeGit(() => commit, () => {
      const c = ref.ctx as Context;
      const bin = archifyBin(c.env, archifyVersion(c.root));
      mkdirSync(join(bin, '..'), { recursive: true });
      writeFileSync(bin, 'ほかの席');
    }), { placed: false });
    ref.ctx = ctx;
    commit = archifyVersion(ctx.root).commit;
    expect(figureSetup(ctx)[0]).toMatch(/^置いた: /);
    expect(readFileSync(archifyBin(ctx.env, archifyVersion(ctx.root)), 'utf8')).toBe('ほかの席');
    expect(readdirSync(join(archifyHome(ctx.env, archifyVersion(ctx.root)), '..')).filter(n => n.startsWith('.tmp-'))).toEqual([]);
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
    expect(lines[0]).toMatch(/^図 fig-flow（flow.json）: [0-9]+ byte・縮める割合 0\.94・2 回で決まった$/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const out = readFileSync(join(dir, 'out.html'), 'utf8');
    expect(out).toMatch(/^<p>前<\/p><figure><svg [^>]*class="fig-flow"[\s\S]*<\/svg><figcaption>図 1<\/figcaption><\/figure><p>後<\/p>$/);
    // 1 回目は縮めずに、2 回目は 805 → 760 の割合で箱の幅を決めた。
    expect(seen.map(j => (j.nodes as { width: number }[])[0]?.width)).toEqual([113, 120]);
    expect(seen[0]?.meta).toMatchObject({ quality_profile: 'standard' });
  });

  test('描く幅が「箱の外の決まった幅 ＋ 箱の幅」の図は、割線で数回のうちに決まり、映る字の入る幅を箱に持つ', () => {
    const seen: Record<string, unknown>[] = [];
    // 箱 4 つと、箱の外の幅 500（Archify の余白と箱の間）。
    const { ctx } = setup(fakeArchify(json => `<svg viewBox="0 0 ${500 + 4 * ((json.nodes as { width: number }[])[0]?.width ?? 0)} 300"><title id="t">x</title></svg>`, seen));
    const { dir, file } = writer();
    const line = figureEmbed(ctx, file, { out: join(dir, 'out.html') })[0] ?? '';
    const rounds = Number(/([0-9]+) 回で決まった/.exec(line)?.[1]);
    const scale = Number(/縮める割合 ([0-9.]+)/.exec(line)?.[1]);
    expect(rounds).toBeLessThanOrEqual(5);
    const width = (seen.at(-1)?.nodes as { width: number }[])[0]?.width ?? 0;
    // 縮めた後の箱の幅（映る px）が、13px の字 5 つ（65）に余白 48 を足した 113 以上。
    expect(width * scale).toBeGreaterThanOrEqual(113 - 1);
  });

  test('Archify が描けない JSON は、診断を並べて止まる。置く用の file には目印を残す', () => {
    const fake: Exec = cmd => cmd === 'env' ? ok(JSON.stringify({ ok: false, diagnostics: [{ code: 'i18n/locale-fallback', message: 'x' }, { code: 'workflow/node-overlap', message: 'Node overlaps\nmore' }] })) : ok();
    const { ctx } = setup(fake);
    const { dir, file } = writer();
    expect(() => figureEmbed(ctx, file, { out: join(dir, 'out.html') })).toThrow(/図 fig-flow（flow.json）を埋められません: [^\n]*描けません[\s\S]*workflow\/node-overlap（場所なし）: Node overlaps\n {2}直し方: 無し（書き手が直す）\n書いた: .*（図 1 つのうち 0 つを埋めた/);
    expect(readFileSync(join(dir, 'out.html'), 'utf8')).toContain('<!-- figure: flow.json -->');
  });

  test('描けない図があっても、ほかの図は埋める（ある図の誤りが、ほかの図の直しを止めない）', () => {
    const fake = fakeArchify(() => FIXTURE);
    const { ctx } = setup((cmd, args, o) => {
      const input = args[args.indexOf('export-svg') + 2] ?? '';
      if (cmd === 'env' && input.endsWith('fig-broken.json')) return ok(JSON.stringify({ ok: false, diagnostics: [{ code: 'workflow/node-overlap', message: 'overlap' }] }));
      return fake(cmd, args, o);
    });
    const { dir } = writer();
    writeFileSync(join(dir, 'broken.json'), JSON.stringify({ diagram_type: 'workflow', nodes: [] }));
    writeFileSync(join(dir, 'two.html'), '<!-- figure: broken.json --><!-- figure: flow.json -->');
    expect(() => figureEmbed(ctx, join(dir, 'two.html'), { out: join(dir, 'out.html') })).toThrow(/^図 fig-flow（flow.json）: [\s\S]*図 fig-broken（broken.json）を埋められません[\s\S]*図 2 つのうち 1 つを埋めた/);
    const out = readFileSync(join(dir, 'out.html'), 'utf8');
    expect(out).toMatch(/^<!-- figure: broken.json --><svg [^>]*class="fig-flow"/);
  });

  test('縮める割合が決まらない図（字が長すぎる）は、字を短くするよう言って止まる', () => {
    // 描く幅が、箱の幅（割合を下げるほど広がる）の 20 倍になる図は、どれだけ縮めても収まらない。
    const { ctx } = setup(fakeArchify(json => `<svg viewBox="0 0 ${20 * ((json.nodes as { width: number }[])[0]?.width ?? 0)} 300"><title id="t">x</title></svg>`));
    const { dir, file } = writer();
    expect(() => figureEmbed(ctx, file, { out: join(dir, 'out.html') })).toThrow(/字が長く、文書の幅（760px）に 13px の字で収まりません/);
  });

  test('書き手の file が無ければ、path を名指して止まる（shot も）', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const dir = temp('embed');
    expect(() => figureEmbed(ctx, join(dir, 'none.html'), { out: join(dir, 'o.html') })).toThrow(`file がありません: ${join(dir, 'none.html')}`);
    expect(() => figureShot(ctx, join(dir, 'none.html'))).toThrow(`file がありません: ${join(dir, 'none.html')}`);
  });

  test('目印が無い・JSON が無い・--out が書き手の file と同じ・Archify が置かれていない時は止まる', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const { dir, file } = writer();
    writeFileSync(join(dir, 'none.html'), '<p>図なし</p>');
    expect(() => figureEmbed(ctx, join(dir, 'none.html'), { out: join(dir, 'o.html') })).toThrow('目印');
    writeFileSync(join(dir, 'lost.html'), '<!-- figure: lost.json -->');
    expect(() => figureEmbed(ctx, join(dir, 'lost.html'), { out: join(dir, 'o.html') })).toThrow('図 fig-lost（lost.json）を埋められません: JSON がありません: lost.json');
    expect(() => figureEmbed(ctx, file, { out: file })).toThrow('同じ path');
    const bare = setup(fakeArchify(() => FIXTURE), { placed: false });
    expect(() => figureEmbed(bare.ctx, file, { out: join(dir, 'o.html') })).toThrow('roster figure setup を打ってから');
  });

  test('英字の無い名の JSON が 2 つでも、図の名と id が重ならない', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const dir = temp('embed');
    mkdirSync(join(dir, 'b'));
    writeFileSync(join(dir, '流れ.json'), JSON.stringify({ diagram_type: 'workflow', meta: { title: 'a' }, nodes: [] }));
    writeFileSync(join(dir, 'b', '図.json'), JSON.stringify({ diagram_type: 'workflow', meta: { title: 'b' }, nodes: [] }));
    writeFileSync(join(dir, 'page.html'), '<!-- figure: 流れ.json --><!-- figure: b/図.json -->');
    expect(figureEmbed(ctx, join(dir, 'page.html'), { out: join(dir, 'out.html') }).slice(0, 2).map(l => l.split('（')[0])).toEqual(['図 fig-x', '図 fig-x-2']);
    const ids = [...readFileSync(join(dir, 'out.html'), 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('同じ JSON の目印が 2 つ（./ の有無が違っても）あれば止まる。読めない JSON は目印を名指して止まる', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const { dir } = writer();
    writeFileSync(join(dir, 'twice.html'), '<!-- figure: flow.json --><!-- figure: ./flow.json -->');
    expect(() => figureEmbed(ctx, join(dir, 'twice.html'), { out: join(dir, 'o.html') })).toThrow('同じ図の目印が 2 つあります: ./flow.json');
    writeFileSync(join(dir, 'bad.json'), '{ 壊れた');
    writeFileSync(join(dir, 'bad.html'), '<!-- figure: bad.json -->');
    expect(() => figureEmbed(ctx, join(dir, 'bad.html'), { out: join(dir, 'o.html') })).toThrow('図 fig-bad（bad.json）を埋められません: JSON を読めません: bad.json');
  });

  test('workflow でない図は、描く幅が 760 を超えれば止まる（箱の幅を合わせないので、字が収まらない）', () => {
    const { ctx } = setup(fakeArchify(() => '<svg viewBox="0 0 1000 300"><title id="t">x</title></svg>'));
    const { dir, file } = writer({ diagram_type: 'lifecycle', meta: { title: 'x' }, states: [] });
    expect(() => figureEmbed(ctx, file, { out: join(dir, 'out.html') })).toThrow(/lifecycle の図は、Archify の描く幅が 1000 で[\s\S]*workflow で描いてください/);
  });

  test('図の名は JSON の file の名から（英小文字・数字・-）', () => {
    expect(figureName('/x/Review Flow.json')).toBe('fig-review-flow');
    expect(figureName('/x/図.json')).toBe('fig-x');
  });
});

describe('roster figure validate', () => {
  test('embed と同じ形（standard・箱の幅を割合が決まるまで決め直す）で描かせ、通れば 1 行', () => {
    const seen: Record<string, unknown>[] = [];
    const { ctx } = setup(fakeArchify(() => FIXTURE, seen));
    const dir = temp('validate');
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({ diagram_type: 'workflow', meta: { locale: 'ja' }, nodes: [{ label: '検査と直し' }] }));
    expect(figureValidate(ctx, join(dir, 'flow.json'))).toEqual([`通った: ${join(dir, 'flow.json')}（縮める割合 0.94）`]);
    expect(seen[0]?.meta).toEqual({ quality_profile: 'standard', legend: { mode: 'hidden' } });
    // embed と同じく、2 回目は 805 → 760 の割合で箱の幅を決め直して描いた。
    expect(seen.map(j => (j.nodes as { width: number }[])[0]?.width)).toEqual([113, 120]);
  });

  test('描けなければ、誤りの診断ごとに場所と直し方（[位置] を先に 3 つまで・[意味]・無し）を並べて止まる。警告は出さない', () => {
    const { ctx } = setup(cmd => cmd === 'env'
      ? ok(JSON.stringify({ ok: false, diagnostics: [
          { code: 'i18n/locale-fallback', severity: 'warning', message: 'x', supportedFixes: ['Use a bundled locale'] },
          { code: 'workflow/node-overlap', severity: 'error', message: 'Nodes overlap\nmore', subject: { path: '/nodes/2' }, supportedFixes: ['set /nodes/2/lane to verified lane id "h"', 'set /nodes/2/lane to verified lane id "w"', 'set /nodes/2/lane to verified lane id "z"', 'set /nodes/2/col to verified free column 2'] },
          { code: 'workflow/unknown-edge-endpoint', severity: 'error', message: 'unknown target', subject: { path: '/edges/3/to' }, supportedFixes: ['set /edges/3/to to verified node id "draw"'] },
          { code: 'workflow/x', severity: 'error', message: 'no fix' },
        ] }))
      : ok());
    const dir = temp('validate');
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({ diagram_type: 'workflow', nodes: [] }));
    let message = '';
    try {
      figureValidate(ctx, join(dir, 'flow.json'));
    }
    catch (e) {
      message = (e as Error).message;
    }
    expect(message.split('\n')).toEqual([
      `落ちた: ${join(dir, 'flow.json')}`,
      '- workflow/node-overlap（/nodes/2）: Nodes overlap',
      '  直し方: [位置] set /nodes/2/col to verified free column 2',
      '  直し方: [意味] set /nodes/2/lane to verified lane id "h"',
      '  直し方: [意味] set /nodes/2/lane to verified lane id "w"',
      '- workflow/unknown-edge-endpoint（/edges/3/to）: unknown target',
      '  直し方: [意味] set /edges/3/to to verified node id "draw"',
      '- workflow/x（場所なし）: no fix',
      '  直し方: 無し（書き手が直す）',
    ]);
  });

  test('誤りの診断が無いのに描けない・字が長すぎる・答えが読めない時も「落ちた」で止まる', () => {
    const dir = temp('validate');
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({ diagram_type: 'workflow', nodes: [{ label: 'a' }] }));
    const none = setup(cmd => cmd === 'env' ? ok(JSON.stringify({ ok: false, diagnostics: [] })) : ok());
    expect(() => figureValidate(none.ctx, join(dir, 'flow.json'))).toThrow('- 誤りの診断が出なかった');
    const long = setup(fakeArchify(json => `<svg viewBox="0 0 ${20 * ((json.nodes as { width: number }[])[0]?.width ?? 0)} 300"><title id="t">x</title></svg>`));
    expect(() => figureValidate(long.ctx, join(dir, 'flow.json'))).toThrow(/落ちた: .*\n- 字が長く[\s\S]*直し方: 無し（書き手が直す）/);
    const broken = setup(cmd => cmd === 'env' ? { status: 2, stdout: 'Error', stderr: 'boom' } : ok());
    expect(() => figureValidate(broken.ctx, join(dir, 'flow.json'))).toThrow('Archify の答えを読めません（終了コード 2）: boom');
  });

  test('箱の位置の直しだけが [位置]。線の端・帯・字は [意味]', () => {
    expect(isPlacementFix('set /nodes/2/col to verified free column 2')).toBe(true);
    expect(isPlacementFix('set /nodes/0/row to 1')).toBe(true);
    expect(isPlacementFix('set /nodes/1/lane to verified lane id "h"')).toBe(false);
    expect(isPlacementFix('set /edges/3/to to verified node id "draw"')).toBe(false);
    expect(isPlacementFix('set /nodes/1/label to "x"')).toBe(false);
  });

  test('file が無い・読めない・diagram_type が無い時は止まる', () => {
    const { ctx } = setup(fakeArchify(() => FIXTURE));
    const dir = temp('validate');
    expect(() => figureValidate(ctx, join(dir, 'none.json'))).toThrow('JSON がありません');
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(() => figureValidate(ctx, join(dir, 'bad.json'))).toThrow('JSON を読めません');
    writeFileSync(join(dir, 'x.json'), '{}');
    expect(() => figureValidate(ctx, join(dir, 'x.json'))).toThrow('diagram_type がありません');
  });
});

describe('--figure（図を名指す）', () => {
  /** 図 2 つ（流れ.json と broken.json）の書き手の file。broken は描けない。 */
  function two(): { ctx: Context, dir: string } {
    const fake = fakeArchify(() => FIXTURE);
    const { ctx } = setup((cmd, args, o) => {
      const input = args[args.indexOf('export-svg') + 2] ?? '';
      if (cmd === 'env' && input.endsWith('fig-broken.json')) return ok(JSON.stringify({ ok: false, diagnostics: [{ code: 'workflow/node-overlap', severity: 'error', message: 'overlap' }] }));
      return fake(cmd, args, o);
    });
    const dir = temp('figure');
    mkdirSync(join(dir, 'figs'));
    writeFileSync(join(dir, 'figs', '流れ.json'), JSON.stringify({ diagram_type: 'workflow', nodes: [] }));
    writeFileSync(join(dir, 'figs', 'broken.json'), JSON.stringify({ diagram_type: 'workflow', nodes: [] }));
    writeFileSync(join(dir, 'page.html'), '<!-- figure: figs/broken.json --><!-- figure: figs/流れ.json -->');
    return { ctx, dir };
  }

  test('embed: 名指した図が埋まれば、ほかの図が描けなくても通り、ほかの図が欠けていることを書く。埋めた図の根に JSON の印（path の hash）を書き、path は書かない', () => {
    const { ctx, dir } = two();
    const lines = figureEmbed(ctx, join(dir, 'page.html'), { out: join(dir, 'page.out.html'), figure: join(dir, 'figs', '流れ.json') });
    expect(lines[0]).toMatch(/^図 fig-x（figs\/流れ.json）: /);
    expect(lines[1]).toMatch(/^ほかの図: 図 fig-broken（figs\/broken.json）を埋められません: [\s\S]*（置く用の file には、この図が欠けている。置く前に直す）$/);
    expect(lines.at(-1)).toMatch(/（図 2 つのうち 1 つを埋めた）$/);
    const out = readFileSync(join(dir, 'page.out.html'), 'utf8');
    expect(out).toContain(`data-src="${figureId(join(dir, 'figs', '流れ.json'))}"`);
    expect(out).not.toContain(dir);
  });

  test('embed: 名指した図が描けなければ、その訳を頭に並べて止まる。目印に無い図は断る', () => {
    const { ctx, dir } = two();
    expect(() => figureEmbed(ctx, join(dir, 'page.html'), { out: join(dir, 'page.out.html'), figure: join(dir, 'figs', 'broken.json') })).toThrow(/^図 fig-broken（figs\/broken.json）を埋められません/);
    expect(() => figureEmbed(ctx, join(dir, 'page.html'), { out: join(dir, 'page.out.html'), figure: join(dir, 'none.json') })).toThrow('--figure の図の目印がありません');
  });

  test('shot: 名指した図だけを検査して撮る（symlink を通した path でも同じ図）', () => {
    const { dir, ctx } = two();
    figureEmbed(ctx, join(dir, 'page.html'), { out: join(dir, 'page.out.html'), figure: join(dir, 'figs', '流れ.json') });
    const shots: string[] = [];
    const chrome: Exec = (_cmd, args) => {
      const shot = args.find(a => a.startsWith('--screenshot='));
      if (shot !== undefined) {
        shots.push(shot);
        writeFileSync(shot.slice('--screenshot='.length), 'png');
      }
      return ok(args.includes('--dump-dom') ? '<pre id="roster-figure-check">[]</pre>' : '');
    };
    symlinkSync(join(dir, 'figs'), join(dir, 'link'));
    const lines = figureShot({ ...ctx, exec: chrome }, join(dir, 'page.out.html'), { dir: join(dir, 'png'), figure: join(dir, 'link', '流れ.json') });
    expect(lines[0]).toBe(`図 fig-x（${join(dir, 'link', '流れ.json')}）: 寸法の検査 0 件`);
    expect(shots).toHaveLength(2);
    expect(() => figureShot({ ...ctx, exec: chrome }, join(dir, 'page.out.html'), { figure: join(dir, 'figs', 'broken.json') })).toThrow('--figure の図がありません');
  });
});

describe('roster figure shot', () => {
  /** Chrome の偽物: --dump-dom には傷を返し、--screenshot= には png を書く。渡された HTML を集める。 */
  function fakeChrome(flaws: unknown[]): { exec: Exec, pages: string[] } {
    const pages: string[] = [];
    const exec: Exec = (_cmd, args) => {
      const url = args.at(-1) ?? '';
      pages.push(readFileSync(fileURLToPath(url), 'utf8'));
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

  test('文書の色の変数は図より前の style から取り、無ければ figures.md の色の変数。空白や # のある folder でも開ける', () => {
    const chrome = fakeChrome([]);
    const { ctx } = setup(chrome.exec);
    const dir = join(temp('shot'), 'a b#c');
    mkdirSync(dir);
    writeFileSync(join(dir, 'out.html'), `<p>x</p>${tidySvg(FIXTURE, { prefix: 'fig-a', version: 'v3.3.2' })}`);
    figureShot(ctx, join(dir, 'out.html'), { dir: join(dir, 'png') });
    expect(chrome.pages[1]).toContain('--fg:#1f2328');
    expect(chrome.pages[1]).not.toContain('.fig-a .t-primary{fill:var(--fg)}body');
  });

  test('Archify で描いた図が無ければ、embed を先に打つよう言って止まる', () => {
    const { ctx } = setup(fakeChrome([]).exec);
    const dir = temp('shot');
    writeFileSync(join(dir, 'out.html'), '<p>x</p>');
    expect(() => figureShot(ctx, join(dir, 'out.html'))).toThrow('先に roster figure embed');
  });
});
