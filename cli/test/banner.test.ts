// Mac のバナー（tpm banner …）: 決め方・設定・cmux の通知の hook・setup と check。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decide, DEFAULT_BANNER, toBannerConfig } from '../src/banner.ts';
import { bannerCheck, bannerHook, bannerLog, bannerSetup, currentPaths, hookCommand, hookEntry } from '../src/commands/banner.ts';
import { wait, waitFile } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Exec } from '../src/exec.ts';
import { TPM_TITLE } from '../src/protocol.ts';
import { BRIEF, world } from './helpers.ts';

const cli = realpathSync(join(import.meta.dirname, '..'));
const root = join(cli, '..');

describe('decide', () => {
  test('show・hide は、そのまま出す・消す', () => {
    expect(decide(DEFAULT_BANNER, { role: 'software-engineer', trigger: 'turn' }).show).toBe(false);
    expect(decide(DEFAULT_BANNER, { role: 'software-engineer', trigger: 'idle' }).show).toBe(false);
    expect(decide(DEFAULT_BANNER, { role: 'devops-engineer', trigger: 'ask' }).show).toBe(true);
    expect(decide(DEFAULT_BANNER, { role: 'tpm', trigger: 'idle' }).show).toBe(false);
    expect(decide(DEFAULT_BANNER, { role: 'tpm', trigger: 'ask' }).show).toBe(true);
  });

  test('pm-wait は、前の「答え終わった」より後に wait pm を打った時だけ出す', () => {
    const at = (s: string): string => `2026-11-21T10:00:${s}.000Z`;
    const base = { role: 'tpm', trigger: 'turn' as const };
    expect(decide(DEFAULT_BANNER, { ...base, lastWait: { kind: 'pm', at: at('30') }, lastTurn: at('10') }).show).toBe(true);
    expect(decide(DEFAULT_BANNER, { ...base, lastWait: { kind: 'pm', at: at('10') }, lastTurn: at('30') }).show).toBe(false);
    expect(decide(DEFAULT_BANNER, { ...base, lastWait: { kind: 'work', at: at('30') }, lastTurn: at('10') }).show).toBe(false);
    expect(decide(DEFAULT_BANNER, base).show).toBe(false);
    // 前の回の記録が無ければ、漏らさない側に倒して出す。
    expect(decide(DEFAULT_BANNER, { ...base, lastWait: { kind: 'pm', at: at('10') } }).show).toBe(true);
  });
});

describe('toBannerConfig', () => {
  test('書かなければ既定。役割の欄は、書いたきっかけだけを上書きする', () => {
    expect(toBannerConfig(undefined)).toEqual(DEFAULT_BANNER);
    const c = toBannerConfig({ banner: { 'devops-engineer': { turn: 'show' }, 'tpm': { idle: 'show' } }, withBanner: ['sound', 'paneFlash'] });
    expect(c.banner['devops-engineer']).toEqual({ turn: 'show', idle: 'hide', ask: 'show' });
    expect(c.banner.tpm).toEqual({ turn: 'pm-wait', idle: 'show', ask: 'show' });
    expect(c.withBanner).toEqual(['sound', 'paneFlash']);
  });

  test('* を書けば、書いていない役割の既定が替わる', () => {
    const c = toBannerConfig({ banner: { '*': { turn: 'show' } } });
    expect(c.banner['*']).toEqual({ turn: 'show', idle: 'hide', ask: 'show' });
    expect(c.banner.tpm).toEqual(DEFAULT_BANNER.banner.tpm);
  });

  test('知らない欄・役割・きっかけ・値は止める', () => {
    expect(() => toBannerConfig({ banners: {} })).toThrow(/知らない欄: banners/);
    expect(() => toBannerConfig({ banner: { pm: { turn: 'show' } } })).toThrow(/知らない役割: pm/);
    expect(() => toBannerConfig({ banner: { tpm: { done: 'show' } } })).toThrow(/知らないきっかけ: tpm.done/);
    expect(() => toBannerConfig({ banner: { tpm: { turn: 'yes' } } })).toThrow(/show・hide・pm-wait/);
    expect(() => toBannerConfig({ withBanner: ['dock'] })).toThrow(/withBanner/);
  });
});

/** TPM 担当と t-x7k2 の担当が名乗った世界と、cmux の workspace list に見立てた居場所（UUID → 宛先・題）。 */
function hooked(seats: { id: string, ref: string, title: string }[] = []) {
  const w = world();
  hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
  assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se = w.role('t-x7k2', 'file:1');
  hello(se);
  const stateHome = dirname(dirname(w.tpm.state.dir));
  const configHome = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-banner-config-')));
  const all = [
    { id: 'U-TPM', ref: 'file:tpm', title: TPM_TITLE },
    { id: 'U-SE', ref: 'file:1', title: 'SWE t-x7k2: 計画と実装' },
    ...seats,
  ];
  const exec: Exec = (cmd, args) => {
    if (cmd === 'cmux' && args.join(' ') === '--json workspace list --id-format both') return { status: 0, stdout: JSON.stringify({ workspaces: all }), stderr: '' };
    return { status: 1, stdout: '', stderr: `unexpected: ${cmd} ${args.join(' ')}` };
  };
  const env = { XDG_STATE_HOME: stateHome, XDG_CONFIG_HOME: configHome };
  let clock = Date.parse('2026-11-21T10:00:00.000Z');
  const hook = (id: string, category: string): string => {
    clock += 1000;
    return bannerHook(JSON.stringify({ version: 1, notification: { workspaceId: id }, agent: { category }, effects: { desktop: true, sound: true } }), { env, exec, now: new Date(clock) });
  };
  /** TPM 担当が tpm wait を打つ（hook と同じ時計で）。 */
  const tpmWait = (kind: 'pm' | 'work', what: string): void => {
    clock += 1000;
    wait({ ...w.tpm, now: () => new Date(clock) }, kind, what);
  };
  return { w, se, env, configHome, hook, tpmWait };
}

const HIDE = JSON.stringify({ effects: { desktop: false, sound: false } });

describe('bannerHook', () => {
  test('担当の答え終わった・入力待ちは消し（音も）、許可/質問は出す', () => {
    const { hook } = hooked();
    expect(hook('U-SE', 'turn-complete')).toBe(HIDE);
    expect(hook('U-SE', 'idle-reminder')).toBe(HIDE);
    expect(hook('U-SE', 'needs-permission')).toBe('{}');
  });

  test('TPM 担当の答え終わったは、その回に wait pm を打った時だけ出す', () => {
    const { hook, tpmWait } = hooked();
    // 名乗った直後は wait の記録が無い（tpm hello は wait を作業中にするだけ）。
    expect(hook('U-TPM', 'turn-complete')).toBe(HIDE);
    tpmWait('pm', '指示');
    expect(hook('U-TPM', 'turn-complete')).toBe('{}');
    // 【merged】をひとりで片付けた回: wait は前のまま（回答待ち(PM): 指示）。
    expect(hook('U-TPM', 'turn-complete')).toBe(HIDE);
    tpmWait('pm', '案の選択');
    expect(hook('U-TPM', 'turn-complete')).toBe('{}');
    tpmWait('work', '振る');
    expect(hook('U-TPM', 'turn-complete')).toBe(HIDE);
    expect(hook('U-TPM', 'idle-reminder')).toBe(HIDE);
  });

  test('名簿に無い居場所・題が違う居場所・知らない category・workspaceId が無い通知は替えない', () => {
    const { hook } = hooked([{ id: 'U-OTHER', ref: 'file:9', title: 'zsh' }, { id: 'U-STALE', ref: 'file:1', title: '別の題' }]);
    expect(hook('U-OTHER', 'turn-complete')).toBe('{}');
    expect(hook('U-NONE', 'turn-complete')).toBe('{}');
    expect(hook('U-SE', 'something-new')).toBe('{}');
    expect(bannerHook(JSON.stringify({ agent: { category: 'turn-complete' } }), { env: {}, exec: () => ({ status: 1, stdout: '', stderr: '' }), now: new Date() })).toBe('{}');
  });

  test('設定を読めなければ消さず、記録に訳を書く', () => {
    const { w, hook, configHome } = hooked();
    mkdirSync(join(configHome, 'tpm'));
    writeFileSync(join(configHome, 'tpm', 'banner.jsonc'), '{ "banner": { "tpm": { "turn": "never" } } }');
    expect(hook('U-SE', 'turn-complete')).toBe('{}');
    expect(bannerLog(w.tpm, 5)[0]).toMatch(/file:1 {2}software-engineer {2}turn-complete {2}出す {2}設定を読めないので出す/);
  });

  test('設定で替えた物に従う（withBanner も）', () => {
    const { hook, configHome } = hooked();
    mkdirSync(join(configHome, 'tpm'));
    writeFileSync(join(configHome, 'tpm', 'banner.jsonc'), '{\n  // 担当の答え終わったも見る\n  "banner": { "software-engineer": { "turn": "show" } },\n  "withBanner": ["sound", "paneFlash"],\n}');
    expect(hook('U-SE', 'turn-complete')).toBe('{}');
    expect(hook('U-SE', 'idle-reminder')).toBe(JSON.stringify({ effects: { desktop: false, sound: false, paneFlash: false } }));
  });

  test('決めたことを project の banner.jsonl に書き、tpm banner log が新しい順に出す', () => {
    const { w, hook } = hooked();
    expect(bannerLog(w.tpm, 5)).toEqual(['記録なし（hook がまだ動いていないか、この project の居場所の通知が無い）']);
    hook('U-SE', 'turn-complete');
    hook('U-SE', 'needs-permission');
    const log = bannerLog(w.tpm, 5);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatch(/needs-permission {2}出す/);
    expect(log[1]).toMatch(/turn-complete {2}消す/);
  });
});

describe('wait の記録', () => {
  test('tpm wait は waits/<宛先>.jsonc に種類と時刻を書く', () => {
    const w = world();
    hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    wait(w.tpm, 'pm', '指示');
    expect(w.tpm.state.read(waitFile('file:tpm'))).toEqual({ kind: 'pm', text: '回答待ち(PM): 指示', at: '2026-11-20T12:00:00.000Z' });
  });
});

describe('setup と check', () => {
  test('hook の命令は、今の Node の folder を PATH の頭に置き、path を引用する', () => {
    expect(hookCommand('/my repo', { node: '/n/bin', cmux: '/c d/bin' })).toBe('PATH=/n/bin:\'/c d/bin\':/usr/bin:/bin \'/my repo/cli/bin/tpm\' banner hook');
    expect(hookEntry('/r', { node: '/n/bin', cmux: '/n/bin' })).toEqual({ id: 'tpm-banner', command: 'PATH=/n/bin:/usr/bin:/bin /r/cli/bin/tpm banner hook', timeoutSeconds: 5 });
    const env = { PATH: process.env.PATH };
    expect(bannerSetup(root, env).join('\n')).toContain(JSON.stringify(hookEntry(root, currentPaths(env))));
  });

  test('cmux は PATH で最初に見つかる folder、無ければ cmux の app の中', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-banner-path-')));
    writeFileSync(join(dir, 'cmux'), '');
    expect(currentPaths({ PATH: `/nowhere:${dir}` }).cmux).toBe(dir);
    expect(currentPaths({ PATH: '/nowhere' }).cmux).toBe('/Applications/cmux.app/Contents/Resources/bin');
    expect(currentPaths({}).node).toBe(dirname(process.execPath));
  });

  test('check は cmux.json の hook が無い・止めてある・命令が古い・合っている、を見分ける', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-banner-cmux-')));
    const env = { XDG_CONFIG_HOME: dir, PATH: process.env.PATH };
    const file = join(dir, 'cmux.json');
    const paths = currentPaths(env);
    const put = (hooks: unknown[]): void => writeFileSync(file, `{\n  // コメント\n  "notifications": { "hooks": ${JSON.stringify(hooks)} },\n}`);
    expect(bannerCheck(root, env, file)).toMatchObject({ ok: false, lines: expect.arrayContaining([expect.stringMatching(/hook がありません/)]) as unknown });
    put([{ ...hookEntry(root, paths), enabled: false }]);
    expect(bannerCheck(root, env, file).lines.at(-1)).toMatch(/enabled: false/);
    put([hookEntry(root, { ...paths, node: '/old/node/bin' })]);
    expect(bannerCheck(root, env, file)).toMatchObject({ ok: false });
    put([{ id: 'other', command: 'true' }, hookEntry(root, paths)]);
    const ok = bannerCheck(root, env, file);
    expect(ok.ok).toBe(true);
    expect(ok.lines).toContain('  tpm: turn=pm-wait idle=hide ask=show');
    expect(ok.lines).toContain('  *: turn=hide idle=hide ask=show');
    expect(ok.lines).toContain('  バナーを消す時に一緒に消す物: sound');
  });
});

describe('tpm banner hook（bin/tpm 経由）', () => {
  // 本物の状態・cmux に触らないよう、環境変数は PATH と一時の folder だけにする。
  const run = (input: string) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-banner-cli-')));
    return spawnSync(join(cli, 'bin', 'tpm'), ['banner', 'hook'], { input, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, XDG_STATE_HOME: dir, XDG_CONFIG_HOME: dir } });
  };

  test('壊れた入力でも {} を返して 0 で終わる', () => {
    const r = run('not json');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('知らない category は cmux に聞かずに {} を返す', () => {
    const r = run(JSON.stringify({ notification: { workspaceId: 'X' }, agent: { category: 'custom' } }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
    expect(r.stderr).toBe('');
  });
});

test('banner.jsonl は 7 日より古い行を消す', () => {
  const { w, hook } = hooked();
  const file = join(w.tpm.state.dir, 'banner.jsonl');
  writeFileSync(file, `${JSON.stringify({ at: '2026-11-01T00:00:00.000Z', workspace: 'file:1', role: 'x', category: 'turn-complete', show: false, reason: '古い' })}\n`);
  hook('U-SE', 'turn-complete');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain('古い');
});
