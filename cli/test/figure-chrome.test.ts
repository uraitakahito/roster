// 寸法の検査の script（src/figure/check.ts の CHECK_SCRIPT）を、本物の Chrome で流す試験。
// Chrome の要る試験なので、CI（Chrome が無い）では飛ばし、Chrome のある手元でだけ流す。
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { figureShot } from '../src/commands/figure.ts';
import { exec } from '../src/exec.ts';
import { tidySvg } from '../src/figure/tidy.ts';
import { world } from './helpers.ts';

const CHROME = process.env.ROSTER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'archify', 'workflow-light.svg'), 'utf8');
const STYLE = '<style>:root{--bg:#fff;--fg:#1f2328;--mute:#59636e;--line:#d1d9e0;--card:#f6f8fa;--a:#1f6feb;--ok:#1a7f37;--mid:#bf8700;--ng:#cf222e}body{font:16px/1.75 system-ui,sans-serif}svg text{fill:var(--fg);font-family:inherit}</style>';

describe.skipIf(process.env.CI !== undefined || !existsSync(CHROME))('寸法の検査（本物の Chrome）', () => {
  /** 図 1 つの文書を書いて shot を打つ。傷が無ければ行を、あれば止まった字を返す。 */
  function shot(svg: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-figure-chrome-')));
    writeFileSync(join(dir, 'out.html'), `<html><head>${STYLE}</head><body>${svg}</body></html>`);
    const ctx = { ...world().tpm, exec, env: { ...process.env, ROSTER_CHROME: CHROME } };
    try {
      return figureShot(ctx, join(dir, 'out.html'), { dir: join(dir, 'png') }).join('\n');
    }
    catch (e) {
      return (e as Error).message;
    }
  }
  const tidy = tidySvg(FIXTURE, { prefix: 'fig-a', version: 'v3.3.2' });

  test('整えた図は傷 0 件', () => {
    expect(shot(tidy)).toContain('寸法の検査 0 件');
  }, 60_000);

  test('箱を狭めた図は「はみ出し」で止まる', () => {
    const narrow = tidy.replace(/(<g [^>]*data-node-id="val"[^>]*>)([\s\S]*?)(<\/g>)/, (_m, head: string, body: string, tail: string) => head + body.replace(/width="[0-9.]+"/g, 'width="40"') + tail);
    expect(shot(narrow)).toMatch(/はみ出し: 検査と直し（箱 val）/);
  }, 60_000);

  test('字を小さくした図は「小さい字」で止まる', () => {
    expect(shot(tidy.replace(/font-size="10\.6"/, 'font-size="7"'))).toMatch(/小さい字: /);
  }, 60_000);
});
