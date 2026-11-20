import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { hello, inbox } from '../src/commands/role-side.ts';
import { assign, close, newKey, roles } from '../src/commands/tpm-side.ts';
import { buildCommand } from '../src/command.ts';
import { modelLabel, modelStatus } from '../src/protocol.ts';
import { readRole, requireRole, writeRole } from '../src/roster.ts';
import { claudeArgs, roleEnv } from '../src/run-role.ts';
import { TpmError } from '../src/skill-sets.ts';
import { world } from './helpers.ts';

const SE = { role: 'software-engineer', title: '計画と実装', brief: 'https://claude.ai/artifact/b1', wait: 0 } as const;

describe('hello（TPM 担当）', () => {
  test('$TPM_KEY が無ければ TPM 担当として名乗る: 宛先を状態に書き、状態を出し、名簿を出す', () => {
    const w = world();
    expect(hello(w.tpm)).toEqual(['TPM 担当の宛先: file:tpm', '課題管理: none・連携: file', '名簿: 担当はいない']);
    expect(w.tpm.state.read('tpm.jsonc')).toEqual({ address: 'file:tpm' });
    expect(w.wire.status('file:tpm')).toEqual({ model: 'Opus 5.5 · medium', wait: '作業中: 起動' });
  });

  test('状態の model・effort は、同じ環境変数で tpm start が出す 1 行と揃う', () => {
    const env = { TPM_MODEL: 'claude-fable-5-2', TPM_EFFORT: 'high' };
    const w = world({}, env);
    hello(w.tpm);
    const line = buildCommand('/w', w.tpm.root, [], env);
    expect(line).toContain(' --model claude-fable-5-2 --effort high ');
    expect(w.wire.status('file:tpm')?.model).toBe(modelStatus('claude-fable-5-2', 'high'));
  });

  test('effort は 旗 > $CLAUDE_EFFORT（実際の effort）> $TPM_EFFORT、model は 旗 > $TPM_MODEL', () => {
    const w = world({}, { TPM_MODEL: 'claude-fable-5-2', TPM_EFFORT: 'high', CLAUDE_EFFORT: 'low' });
    hello(w.tpm);
    expect(w.wire.status('file:tpm')?.model).toBe('Fable 5.2 · low');
    hello(w.tpm, { model: 'claude-opus-5-5', effort: 'max' });
    expect(w.wire.status('file:tpm')?.model).toBe('Opus 5.5 · max');
  });
});

describe('assign', () => {
  test('名簿に書き、短い命令で居場所を作る', () => {
    const w = world();
    const out = assign(w.tpm, 't-x7k2', SE);
    const record = requireRole(w.tpm, 't-x7k2');
    expect(record).toEqual({
      key: 't-x7k2',
      role: 'software-engineer',
      title: 'SWE t-x7k2: 計画と実装',
      cwd: w.project,
      addDirs: [`${w.tpm.root}/skill-sets/core`],
      model: 'claude-opus-5-5',
      effort: 'medium',
      permissionMode: 'bypassPermissions',
      brief: 'https://claude.ai/artifact/b1',
      address: 'file:1',
    });
    expect(w.wire.command('file:1')).toBe(`${w.tpm.root}/cli/bin/tpm run-role t-x7k2 --project ${w.project} --state ${w.tpm.state.dir}`);
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'SWE t-x7k2: 計画と実装' }]);
    expect(out).toEqual(['起こした: SWE t-x7k2: 計画と実装（file:1・Opus 5.5 · medium）', '名乗り（tpm hello）は待っていない']);
  });

  test('model などは 旗 > config.jsonc > 役割の既定 の順で決まる', () => {
    const w = world({ 'skill-sets': ['dependabot'], 'devops-engineer': { model: 'claude-fable-5-2' } });
    assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0, effort: 'high' });
    expect(requireRole(w.tpm, 'devops')).toMatchObject({
      title: 'DevOps',
      model: 'claude-fable-5-2',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      addDirs: [`${w.tpm.root}/skill-sets/core`, `${w.tpm.root}/skill-sets/dependabot`],
    });
  });

  test('環境変数は config.jsonc の担当の欄に負け、役割の既定に勝つ', () => {
    const env = { TPM_MODEL: 'claude-sonnet-5-5', TPM_EFFORT: 'high', TPM_PERMISSION_MODE: 'acceptEdits' };
    const w = world({ 'devops-engineer': { model: 'claude-fable-5-2' } }, env);
    assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 });
    expect(requireRole(w.tpm, 'devops')).toMatchObject({ model: 'claude-fable-5-2', effort: 'high', permissionMode: 'acceptEdits' });
    assign(w.tpm, 'gh#1', { role: 'sustaining-engineer', wait: 0, effort: 'low' });
    expect(requireRole(w.tpm, 'gh#1')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'acceptEdits' });
  });

  test('担当が名乗るまで待つ', () => {
    const w = world();
    hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    let n = 0;
    const tpm = {
      ...w.tpm,
      sleep: () => {
        n += 1;
        if (n === 2) hello(w.role('t-x7k2', 'file:1'));
      },
    };
    expect(assign(tpm, 't-x7k2', { ...SE, wait: 90 })[1]).toBe('名乗った（tpm hello が来た）');
    expect(n).toBe(2);
  });

  test('名乗らなければ、画面の終わりを添えて止まり、居場所は残す', () => {
    const w = world();
    const tpm = { ...w.tpm, transport: Object.assign(w.wire, { screen: () => 'line 1\nError: something\n' }) };
    expect(() => assign(tpm, 't-x7k2', { ...SE, wait: 4 })).toThrow(/4 秒たっても名乗りません。居場所は残してあります。画面の終わり:\nline 1\nError: something/);
    expect(w.slept()).toBe(2);
    expect(w.wire.seats()).toHaveLength(1);
  });

  test.each([
    ['信頼のダイアログ', 'Adding a new directory: /x\nIs this a directory you created or one you trust?', /信頼のダイアログで止まっていたので、Yes は押さずに閉じました/],
    ['命令の誤り', 'Unknown command: /software-engineer', /Unknown command でした/],
  ])('%sなら居場所を閉じてから止まる', (_, screen, message) => {
    const w = world();
    const tpm = { ...w.tpm, transport: Object.assign(w.wire, { screen: () => screen }) };
    expect(() => assign(tpm, 't-x7k2', { ...SE, wait: 2 })).toThrow(message);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 't-x7k2')?.address).toBeUndefined();
  });

  test.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('--wait が %s なら、起こす前に止まる', (wait) => {
    const w = world();
    expect(() => assign(w.tpm, 't-x7k2', { ...SE, wait })).toThrow(/--wait は 0 以上の数にしてください/);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 't-x7k2')).toBeUndefined();
  });

  test('動いている担当の鍵では起こさない。居場所が消えていれば起こし直す', () => {
    const w = world();
    assign(w.tpm, 't-x7k2', SE);
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', wait: 0 })).toThrow(/t-x7k2 の担当はもう動いています（file:1）。新しい依頼書を --brief で/);
    expect(w.wire.seats()).toHaveLength(1);
    w.wire.close('file:1');
    expect(assign(w.tpm, 't-x7k2', SE)[0]).toMatch(/^起こし直した: .*file:2/);
  });

  test('この project の課題管理の鍵でない課題は断る', () => {
    expect(() => assign(world().tpm, 't-x7k2', { ...SE, issue: 'SKILLS-12' })).toThrow(/課題管理（none）の鍵ではありません/);
    const w = world({ tracker: 'github' });
    assign(w.tpm, 'gh-12', { ...SE, issue: 'gh-12' });
    expect(requireRole(w.tpm, 'gh-12').issue).toBe('gh-12');
  });

  test('鍵に空白などは使えない', () => {
    expect(() => assign(world().tpm, 't x', SE)).toThrow(TpmError);
  });

  test('t- の鍵は t- と英小文字・数字 4 文字だけ。課題管理の鍵・devops・<repo>#<PR> は問わない', () => {
    for (const key of ['t-jsonc-check', 't-abc', 't-abcde', 't-AB12']) {
      expect(() => assign(world().tpm, key, SE)).toThrow(/t- と英小文字・数字 4 文字にしてください（tpm key で作る）/);
    }
    const w = world();
    expect(assign(w.tpm, 't-0o1l', SE)[0]).toMatch(/^起こした: SWE t-0o1l: 計画と実装/);
    expect(assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 })[0]).toMatch(/^起こした: DevOps（/);
    expect(assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 })[0]).toMatch(/^起こした: Sustaining app#12（/);
  });

  test('名簿にある前の決まりの長い鍵は、そのまま【brief】を送れ、起こし直せる', () => {
    const w = world();
    writeRole(w.tpm, { key: 't-jsonc-check', role: 'software-engineer', title: 'Software Engineer t-jsonc-check: JSONC', cwd: w.project, addDirs: [], model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' });
    expect(assign(w.tpm, 't-jsonc-check', SE)[0]).toMatch(/^起こし直した: SWE t-jsonc-check: 計画と実装/);
    expect(assign(w.tpm, 't-jsonc-check', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 })[0]).toMatch(/^送った: 【brief】/);
  });
});

describe('newKey', () => {
  /** 置き場を一時の folder にした TPM 担当の周り。 */
  function setup() {
    const pages = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-pages-')));
    const w = world();
    return { w, tpm: { ...w.tpm, env: { ...w.tpm.env, TPM_PAGES_DIR: pages } }, pages };
  }
  /** 決めた並びの数を順に返す pick。 */
  const sequence = (...ns: number[]) => {
    let i = 0;
    return () => ns[i++ % ns.length] ?? 0;
  };

  test('t- と、読み違えやすい 0・o・1・l・i を除いた英小文字・数字 4 文字を作る', () => {
    const { tpm } = setup();
    for (let i = 0; i < 200; i++) expect(newKey(tpm)).toMatch(/^t-[2-9a-hjkmnp-z]{4}$/);
    expect(newKey(tpm, sequence(0, 7, 8, 30))).toBe('t-29az');
  });

  test('名簿の担当の鍵と、置き場にページの folder がある鍵は避ける', () => {
    const { tpm, pages } = setup();
    assign(tpm, 't-2222', SE);
    mkdirSync(join(pages, basename(tpm.state.dir), 't-3333'), { recursive: true });
    expect(newKey(tpm, sequence(0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2))).toBe('t-4444');
  });

  test('100 回ぶつかれば止める', () => {
    const { tpm } = setup();
    assign(tpm, 't-2222', SE);
    expect(() => newKey(tpm, () => 0)).toThrow(/使われていない鍵を 100 回で作れませんでした/);
  });
});

describe('hello', () => {
  test('状態を出し、名簿に宛先と時刻を書き、受け持ちを返す', () => {
    const w = world();
    hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    assign(w.tpm, 't-x7k2', { ...SE, model: 'claude-fable-5-2' });
    expect(hello(w.role('t-x7k2', 'file:1'))).toEqual([
      '役割: Software Engineer',
      '課題の鍵: t-x7k2',
      '依頼書: https://claude.ai/artifact/b1',
      '課題管理の課題: 無し（道具: none）',
      'TPM 担当の宛先: file:tpm',
      '自分の宛先: file:1',
    ]);
    expect(requireRole(w.tpm, 't-x7k2').helloAt).toBe('2026-11-20T12:00:00.000Z');
    expect(w.wire.status('file:1')).toEqual({ model: 'Fable 5.2 · medium', wait: '作業中: 依頼書を読む' });
  });

  test('名簿にいない鍵なら止まる', () => {
    expect(() => hello(world().role('t-nope', 'file:9'))).toThrow(/名簿に担当がいません: t-nope/);
  });

  test('担当が --model・--effort を付けたら止まり、名簿も状態も書かない', () => {
    const w = world();
    hello(w.tpm);
    assign(w.tpm, 't-x7k2', SE);
    const se = w.role('t-x7k2', 'file:1');
    expect(() => hello(se, { model: 'claude-fable-5-2' })).toThrow(/--model・--effort は TPM 担当が名乗るときだけ使う/);
    expect(() => hello(se, { effort: 'high' })).toThrow(TpmError);
    expect(requireRole(w.tpm, 't-x7k2').helloAt).toBeUndefined();
    expect(w.wire.status('file:1')).toBeUndefined();
  });
});

describe('inbox', () => {
  test('まだ届いていないメッセージを、差出人と id を添えて出す', () => {
    const w = world();
    expect(inbox(w.tpm)).toEqual(['まだ届いていないメッセージは無い']);
    const tpm = { ...w.tpm, transport: Object.assign(w.wire, { pending: () => [{ id: 'm1', from: 'Technical Program Manager', text: '【brief】u' }] }) };
    expect(inbox(tpm)).toEqual(['--- Technical Program Manager（id m1）', '【brief】u']);
  });
});

describe('roles と close', () => {
  test('動いている担当は状態を、消えた担当は消えたと出す', () => {
    const w = world();
    hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    assign(w.tpm, 't-a3b4', SE);
    assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    hello(w.role('t-a3b4', 'file:1'));
    w.wire.close('file:2');
    expect(roles(w.tpm)).toEqual([
      '名簿:',
      '- app#12  Sustaining app#12  消えた（居場所が無い。tpm assign で起こし直すか、tpm close で名簿から消す）',
      '- t-a3b4  SWE t-a3b4: 計画と実装  file:1（作業中: 依頼書を読む）  依頼書: https://claude.ai/artifact/b1',
    ]);
  });

  test('close は居場所を閉じて名簿から消す。居場所が無くても名簿からは消す', () => {
    const w = world();
    assign(w.tpm, 't-a3b4', SE);
    assign(w.tpm, 't-b5c6', SE);
    w.wire.close('file:2');
    expect(close(w.tpm, 't-a3b4')).toEqual(['閉じた: SWE t-a3b4: 計画と実装（file:1）']);
    expect(close(w.tpm, 't-b5c6')).toEqual(['閉じた: SWE t-b5c6: 計画と実装（居場所はもう無かった）']);
    expect(w.wire.seats()).toEqual([]);
    expect(roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    expect(() => close(w.tpm, 't-a3b4')).toThrow(/名簿に担当がいません/);
  });
});

describe('run-role', () => {
  test('claude の引数は、guard の hook を付け、最初の入力の前に -- を置く', () => {
    const w = world({ 'skill-sets': ['dependabot'] });
    assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    expect(claudeArgs(requireRole(w.tpm, 'app#12'), '/r')).toEqual([
      '--settings',
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/r/cli/bin/tpm guard"}]}]}}',
      '--model',
      'claude-opus-5-5',
      '--effort',
      'medium',
      '--permission-mode',
      'bypassPermissions',
      '--add-dir',
      `${w.tpm.root}/skill-sets/core`,
      `${w.tpm.root}/skill-sets/dependabot`,
      '--',
      '/sustaining-engineer',
    ]);
  });

  test('担当に project・状態の folder・鍵・役割と、tpm の在り処を渡す', () => {
    const w = world();
    assign(w.tpm, 't-x7k2', SE);
    expect(roleEnv(requireRole(w.tpm, 't-x7k2'), '/p', '/s', '/r', { PATH: '/usr/bin', HOME: '/h' })).toEqual({
      HOME: '/h',
      TPM_PROJECT: '/p',
      TPM_STATE: '/s',
      TPM_KEY: 't-x7k2',
      TPM_ROLE: 'software-engineer',
      PATH: '/r/cli/bin:/usr/bin',
    });
  });
});

describe('modelLabel', () => {
  test.each([['claude-opus-5-5', 'Opus 5.5'], ['claude-fable-5-2', 'Fable 5.2'], ['claude-haiku-5-5-20261001', 'Haiku 5.5'], ['my-model', 'my-model']])('%s → %s', (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });
});
