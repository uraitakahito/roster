// 通知のバナー（roster banner …）: 決め方・設定・cmux の通知の hook・setup と check。
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decide, DEFAULT_BANNER, toBannerConfig } from '../src/banner.ts';
import { bannerCheck, bannerHook, bannerLog, bannerSetup, hookCommand, hookEntry } from '../src/commands/banner.ts';
import { wait, waitFile } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, bannerHint } from '../src/commands/tpm-side.ts';
import type { Exec } from '../src/exec.ts';
import { TPM_TITLE } from '../src/protocol.ts';
import { writeRole } from '../src/roster.ts';
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

  test('Auditor の既定は TPM 担当と同じ（Product Manager を待つ回だけ出す）。* を書いても替わらない', () => {
    expect(DEFAULT_BANNER.banner.auditor).toEqual({ turn: 'pm-wait', idle: 'hide', ask: 'show' });
    expect(toBannerConfig({ banner: { '*': { turn: 'show' } } }).banner.auditor).toEqual({ turn: 'pm-wait', idle: 'hide', ask: 'show' });
    expect(toBannerConfig({ banner: { auditor: { turn: 'show' } } }).banner.auditor).toEqual({ turn: 'show', idle: 'hide', ask: 'show' });
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
async function hooked(seats: { id: string, ref: string, title: string }[] = []) {
  const w = world();
  await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
  await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se = w.role('t-x7k2', 'file:1');
  await hello(se);
  const stateHome = dirname(dirname(w.tpm.state.dir));
  const configHome = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-config-')));
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
  /** TPM 担当が roster wait を打つ（hook と同じ時計で）。 */
  const tpmWait = (kind: 'pm' | 'work', what: string): void => {
    clock += 1000;
    wait({ ...w.tpm, now: () => new Date(clock) }, kind, what);
  };
  return { w, se, env, configHome, hook, tpmWait };
}

const HIDE = JSON.stringify({ effects: { desktop: false, sound: false } });

describe('bannerHook', () => {
  test('担当の答え終わった・入力待ちは消し（音も）、許可/質問は出す', async () => {
    const { hook } = await hooked();
    expect(hook('U-SE', 'turn-complete')).toBe(HIDE);
    expect(hook('U-SE', 'idle-reminder')).toBe(HIDE);
    expect(hook('U-SE', 'needs-permission')).toBe('{}');
  });

  test('TPM 担当の答え終わったは、その回に wait pm を打った時だけ出す', async () => {
    const { hook, tpmWait } = await hooked();
    // 名乗った直後は wait の記録が無い（roster hello は wait を作業中にするだけ）。
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

  // Auditor の席は Product Manager が起こすが、名簿の行（宛先と題 Audit）があれば、hook は役割 auditor と見分ける。
  test('Auditor の席の答え終わったは、その回に Product Manager を待った時（報告した回）だけ出す', async () => {
    const { w, hook } = await hooked([{ id: 'U-AUDIT', ref: 'file:7', title: 'Audit' }]);
    writeRole(w.tpm, { key: 'audit', role: 'auditor', title: 'Audit', cwd: w.project, addDirs: [], model: 'claude-fable-5-2', effort: 'high', permissionMode: 'bypassPermissions', address: 'file:7' });
    // 名乗っただけの回（roster hello は wait の記録を書かない）と、入力待ちの催促は消す。
    expect(hook('U-AUDIT', 'turn-complete')).toBe(HIDE);
    expect(hook('U-AUDIT', 'idle-reminder')).toBe(HIDE);
    wait({ ...w.role('audit', 'file:7'), now: () => new Date('2026-11-21T10:00:02.500Z') }, 'pm', '監査の報告');
    expect(hook('U-AUDIT', 'turn-complete')).toBe('{}');
    expect(hook('U-AUDIT', 'turn-complete')).toBe(HIDE);
    expect(hook('U-AUDIT', 'needs-permission')).toBe('{}');
    expect(bannerLog(w.tpm, 5).map(l => l.split('  ').slice(1, 5).join(' '))).toEqual([
      'file:7 auditor needs-permission 出す',
      'file:7 auditor turn-complete 消す',
      'file:7 auditor turn-complete 出す',
      'file:7 auditor idle-reminder 消す',
      'file:7 auditor turn-complete 消す',
    ]);
  });

  test('名簿に無い居場所・題が違う居場所・知らない category・workspaceId が無い通知は替えない', async () => {
    const { hook } = await hooked([{ id: 'U-OTHER', ref: 'file:9', title: 'zsh' }, { id: 'U-STALE', ref: 'file:1', title: '別の題' }]);
    expect(hook('U-OTHER', 'turn-complete')).toBe('{}');
    expect(hook('U-NONE', 'turn-complete')).toBe('{}');
    expect(hook('U-SE', 'something-new')).toBe('{}');
    expect(bannerHook(JSON.stringify({ agent: { category: 'turn-complete' } }), { env: {}, exec: () => ({ status: 1, stdout: '', stderr: '' }), now: new Date() })).toBe('{}');
  });

  test('設定を読めなければ消さず、記録に訳を書く', async () => {
    const { w, hook, configHome } = await hooked();
    mkdirSync(join(configHome, 'roster'));
    writeFileSync(join(configHome, 'roster', 'banner.jsonc'), '{ "banner": { "tpm": { "turn": "never" } } }');
    expect(hook('U-SE', 'turn-complete')).toBe('{}');
    expect(bannerLog(w.tpm, 5)[0]).toMatch(/file:1 {2}software-engineer {2}turn-complete {2}出す {2}設定を読めないので出す/);
  });

  test('設定で替えた物に従う（withBanner も）', async () => {
    const { hook, configHome } = await hooked();
    mkdirSync(join(configHome, 'roster'));
    writeFileSync(join(configHome, 'roster', 'banner.jsonc'), '{\n  // 担当の答え終わったも見る\n  "banner": { "software-engineer": { "turn": "show" } },\n  "withBanner": ["sound", "paneFlash"],\n}');
    expect(hook('U-SE', 'turn-complete')).toBe('{}');
    expect(hook('U-SE', 'idle-reminder')).toBe(JSON.stringify({ effects: { desktop: false, sound: false, paneFlash: false } }));
  });

  // 古い名の頃の在り処 ~/.config/tpm（t-4urw）は読まない。知らせるのは banner check と TPM 担当の roster hello。
  test('古い在り処（~/.config/tpm）の設定は読まず、既定で決める', async () => {
    const { hook, configHome } = await hooked();
    mkdirSync(join(configHome, 'tpm'));
    writeFileSync(join(configHome, 'tpm', 'banner.jsonc'), '{ "banner": { "software-engineer": { "turn": "show" } } }');
    expect(hook('U-SE', 'turn-complete')).toBe(HIDE);
    mkdirSync(join(configHome, 'roster'));
    writeFileSync(join(configHome, 'roster', 'banner.jsonc'), '{ "banner": { "software-engineer": { "idle": "show" } } }');
    expect(hook('U-SE', 'turn-complete')).toBe(HIDE);
    expect(hook('U-SE', 'idle-reminder')).toBe('{}');
  });

  test('決めたことを project の banner.jsonl に書き、roster banner log が新しい順に出す', async () => {
    const { w, hook } = await hooked();
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
  test('roster wait は waits/<宛先>.jsonc に種類と時刻を書く', async () => {
    const w = world();
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    wait(w.tpm, 'pm', '指示');
    expect(w.tpm.state.read(waitFile('file:tpm'))).toEqual({ kind: 'pm', text: '回答待ち(PM): 指示', at: '2026-11-20T12:00:00.000Z' });
  });
});

describe('setup と check', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-home-')));
  /** 入口の字 E から、cmux.json に書く命令（入口が無ければ {} を返して 0 で終わる）を組む。 */
  const guarded = (e: string): string => `[ -x ${e} ] || { echo '{}'; exit 0; }; exec ${e} banner hook`;
  /** 古い形（Node と cmux の folder を PATH に書いた形）の命令。 */
  const OLD = 'PATH=/Users/me/.nodenv/versions/26.13.0/bin:/Applications/cmux.app/Contents/Resources/bin:/usr/bin:/bin /Users/me/roster/cli/bin/roster banner hook';

  test('hook の命令は Node と cmux の path を書かず、home の下なら "$HOME/…" で入口を呼ぶ。入口が無ければ何もしない', () => {
    expect(hookCommand(join(home, 'projects', 'roster'), { HOME: home })).toBe(guarded('"$HOME/projects/roster/cli/bin/roster"'));
    expect(hookEntry(join(home, 'r'), { HOME: home })).toEqual({ id: 'roster-banner', command: guarded('"$HOME/r/cli/bin/roster"'), timeoutSeconds: 5 });
    expect(bannerSetup(root, { HOME: home }).join('\n')).toContain(JSON.stringify(hookEntry(root, { HOME: home })));
    expect(bannerSetup(root, { HOME: home }).join('\n')).not.toMatch(/Node を上げたら/);
  });

  test('二重引用符の中で意味を持つ字の path と home の外は、一重引用符の絶対 path にする', () => {
    expect(hookCommand(join(home, 'my repo'), { HOME: home })).toBe(guarded(`'${home}/my repo/cli/bin/roster'`));
    expect(hookCommand(join(home, 'a$b'), { HOME: home })).toBe(guarded(`'${home}/a$b/cli/bin/roster'`));
    expect(hookCommand('/opt/roster', { HOME: home })).toBe(guarded('/opt/roster/cli/bin/roster'));
    expect(hookCommand('/opt/roster', {})).toBe(guarded('/opt/roster/cli/bin/roster'));
  });

  test('~/.local/bin/roster がこの repo の入口を指していれば、それを呼ぶ。別の repo を指していれば使わない', () => {
    const h = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-link-')));
    mkdirSync(join(h, '.local', 'bin'), { recursive: true });
    symlinkSync(join(root, 'cli', 'bin', 'roster'), join(h, '.local', 'bin', 'roster'));
    expect(hookCommand(root, { HOME: h })).toBe(guarded('"$HOME/.local/bin/roster"'));
    expect(hookCommand('/opt/other', { HOME: h })).toBe(guarded('/opt/other/cli/bin/roster'));
  });

  test('check は cmux.json の hook が無い・止めてある・古い形・合っている、を見分ける', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-cmux-')));
    const env = { XDG_CONFIG_HOME: dir, HOME: home };
    const file = join(dir, 'cmux.json');
    const put = (hooks: unknown[]): void => writeFileSync(file, `{\n  // コメント\n  "notifications": { "hooks": ${JSON.stringify(hooks)} },\n}`);
    expect(bannerCheck(root, env, file)).toMatchObject({ ok: false, lines: expect.arrayContaining([expect.stringMatching(/hook がありません/)]) as unknown });
    put([{ ...hookEntry(root, env), enabled: false }]);
    expect(bannerCheck(root, env, file).lines.at(-1)).toMatch(/enabled: false/);
    put([{ id: 'roster-banner', command: OLD }]);
    expect(bannerCheck(root, env, file)).toMatchObject({ ok: false });
    expect(bannerCheck(root, env, file).lines.at(-1)).toMatch(/古い形です（Node と cmux の path/);
    // 入口を呼ぶだけで、入口が無い時の guard が無い形（t-u5k9 から t-eda5 まで setup が出していた形）。
    const unguarded = hookCommand(root, env).replace(/^\[ -x (.+) \] \|\| \{ echo '\{\}'; exit 0; \}; exec \1 banner hook$/, '$1 banner hook');
    expect(unguarded).toMatch(/^\S+ banner hook$/);
    put([{ id: 'roster-banner', command: unguarded }]);
    expect(bannerCheck(root, env, file)).toMatchObject({ ok: false });
    expect(bannerCheck(root, env, file).lines.at(-1)).toMatch(/古い形です（roster の無い機械で通知のたびに失敗する形）/);
    put([{ id: 'roster-banner', command: guarded('/opt/moved/cli/bin/roster') }]);
    expect(bannerCheck(root, env, file).lines.at(-1)).toMatch(/在り処と違います/);
    put([{ id: 'other', command: 'true' }, hookEntry(root, env)]);
    const ok = bannerCheck(root, env, file);
    expect(ok.ok).toBe(true);
    expect(ok.lines).toContain('  tpm: turn=pm-wait idle=hide ask=show');
    expect(ok.lines).toContain('  *: turn=hide idle=hide ask=show');
    expect(ok.lines).toContain('  バナーを消す時に一緒に消す物: sound');
    expect(ok.lines[0]).toBe(`設定: ${join(dir, 'roster', 'banner.jsonc')}（無いので既定）`);
    expect(ok.lines.join('\n')).not.toMatch(/前の名/);
    // 前の id（tpm-banner。t-6ydg で替えた）は、命令が合っていれば ok のまま、替える 1 行を足す。
    put([{ ...hookEntry(root, env), id: 'tpm-banner' }]);
    const legacy = bannerCheck(root, env, file);
    expect(legacy.ok).toBe(true);
    expect(legacy.lines.at(-1)).toBe('cmux.json の hook の id が前の名（tpm-banner）です。roster-banner に替えてください（動きは変わらない）');
    // 命令が古い時も、id のことを一緒に出す（直す手を 1 回で済ませる）。
    put([{ id: 'tpm-banner', command: OLD }]);
    expect(bannerCheck(root, env, file).lines.slice(-2)).toEqual([expect.stringMatching(/古い形です/), expect.stringMatching(/id が前の名/)]);
    // 新旧の 2 行が並べば、新しい id の行を見て、2 行あると知らせる。
    put([{ id: 'tpm-banner', command: OLD }, hookEntry(root, env)]);
    const both = bannerCheck(root, env, file);
    expect(both.ok).toBe(false);
    expect(both.lines).toContain(`cmux.json の hook: あり（${file}）`);
    expect(both.lines.at(-1)).toBe('cmux.json に roster の hook が 2 行あります（通知ごとに重ねて動く）。roster-banner の 1 行だけを残してください');
  });

  test('check は古い在り処（~/.config/tpm）の設定を読まず、移す手を出して ok にしない', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-old-')));
    const env = { XDG_CONFIG_HOME: dir, HOME: home };
    const file = join(dir, 'cmux.json');
    writeFileSync(file, JSON.stringify({ notifications: { hooks: [hookEntry(root, env)] } }));
    mkdirSync(join(dir, 'tpm'));
    writeFileSync(join(dir, 'tpm', 'banner.jsonc'), '{ "banner": { "software-engineer": { "turn": "show" } } }');
    const onlyOld = bannerCheck(root, env, file);
    expect(onlyOld.ok).toBe(false);
    expect(onlyOld.lines[0]).toMatch(/（無いので既定）$/);
    expect(onlyOld.lines).not.toContain('  software-engineer: turn=show idle=hide ask=show');
    expect(onlyOld.lines).toContain(`設定が古い在り処にあり、読みません（既定で動く）。移す: mkdir -p ${join(dir, 'roster')} && mv ${join(dir, 'tpm', 'banner.jsonc')} ${join(dir, 'roster', 'banner.jsonc')}`);
    mkdirSync(join(dir, 'roster'));
    writeFileSync(join(dir, 'roster', 'banner.jsonc'), '{ "banner": { "devops-engineer": { "turn": "show" } } }');
    const both = bannerCheck(root, env, file);
    expect(both.ok).toBe(false);
    expect(both.lines).toContain('  devops-engineer: turn=show idle=hide ask=show');
    expect(both.lines).toContain(`古い在り処の設定は読みません（${join(dir, 'roster', 'banner.jsonc')} を読む）。古い方は消してよい: rm ${join(dir, 'tpm', 'banner.jsonc')}`);
  });
});

describe('入口（bin/roster）を cmux の app と同じ既定の PATH で起こす', () => {
  // cmux の app が hook に渡す PATH。TPM_* と cmux の変数は渡さない（本物の project と cmux に触らない）。
  const APP_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  /** 一時の home と、nodenv の root（shims/node を置ける）を作る。 */
  const sandbox = (shim?: string): { home: string, nodenv: string } => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'roster-entry-')));
    const nodenv = join(home, 'nodenv');
    mkdirSync(join(nodenv, 'shims'), { recursive: true });
    if (shim !== undefined) {
      writeFileSync(join(nodenv, 'shims', 'node'), `#!/bin/sh\n${shim}\n`);
      chmodSync(join(nodenv, 'shims', 'node'), 0o755);
    }
    return { home, nodenv };
  };
  const NODE = `exec '${process.execPath}' "$@"`;
  /** cmux に聞かずに {} を返す通知（知らない category）。 */
  const UNKNOWN = JSON.stringify({ notification: { workspaceId: 'X' }, agent: { category: 'custom' } });
  const run = (env: NodeJS.ProcessEnv, input = UNKNOWN) =>
    spawnSync(join(cli, 'bin', 'roster'), ['banner', 'hook'], { input, encoding: 'utf8', cwd: '/', env });

  test('PATH に node が無ければ nodenv の shim で動く', () => {
    const { home, nodenv } = sandbox(NODE);
    const r = run({ PATH: APP_PATH, HOME: home, NODENV_ROOT: nodenv, XDG_STATE_HOME: home, XDG_CONFIG_HOME: home });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('NODENV_ROOT が無ければ ~/.nodenv の shim を探す', () => {
    const { home } = sandbox();
    mkdirSync(join(home, '.nodenv', 'shims'), { recursive: true });
    writeFileSync(join(home, '.nodenv', 'shims', 'node'), `#!/bin/sh\n${NODE}\n`);
    chmodSync(join(home, '.nodenv', 'shims', 'node'), 0o755);
    const r = run({ PATH: APP_PATH, HOME: home, XDG_STATE_HOME: home, XDG_CONFIG_HOME: home });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('node がどこにも無ければ、探した所を出して 2 で終わる（hook の guard が命令を止める数。ほかの数では止めずに通す）', () => {
    const { home, nodenv } = sandbox();
    const r = run({ PATH: APP_PATH, HOME: home, NODENV_ROOT: nodenv });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`roster: node が見つかりません（PATH と ${nodenv}/shims/node を探した）`);
  });

  test('cli/node_modules が無ければ、入れ方を出して 2 で終わる（guard が守り無しで通さない）', () => {
    const { home } = sandbox();
    const copy = join(home, 'roster-copy', 'cli');
    mkdirSync(join(copy, 'bin'), { recursive: true });
    copyFileSync(join(cli, 'bin', 'roster'), join(copy, 'bin', 'roster'));
    chmodSync(join(copy, 'bin', 'roster'), 0o755);
    const r = spawnSync(join(copy, 'bin', 'roster'), ['guard'], { input: '{}', encoding: 'utf8', cwd: '/', env: { PATH: APP_PATH, HOME: home } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`roster: ${copy}/node_modules がありません。Product Manager が自分の terminal で cd ${copy} && pnpm install --frozen-lockfile を打ってください（担当の Bash は、入れるまで guard が止める）`);
  });

  test('PATH に cmux が無ければ cmux の app の bin を後ろに足し、node があれば shim を足さない', () => {
    const { home, nodenv } = sandbox('printf %s "$PATH"');
    const r = run({ PATH: APP_PATH, HOME: home, NODENV_ROOT: nodenv });
    expect(r.stdout).toBe(`${nodenv}/shims:${APP_PATH}:/Applications/cmux.app/Contents/Resources/bin`);
    const bin = join(home, 'bin');
    mkdirSync(bin);
    for (const name of ['node', 'cmux']) {
      writeFileSync(join(bin, name), '#!/bin/sh\nprintf %s "$PATH"\n');
      chmodSync(join(bin, name), 0o755);
    }
    expect(run({ PATH: `${bin}:${APP_PATH}`, HOME: home, NODENV_ROOT: nodenv }).stdout).toBe(`${bin}:${APP_PATH}`);
  });

  /** cmux.json に書く命令の字を、cmux の app と同じく HOME だけを持つ環境の /bin/sh -c で流す。 */
  const sh = (command: string, home: string, nodenv: string) =>
    spawnSync('/bin/sh', ['-c', command], { input: UNKNOWN, encoding: 'utf8', cwd: '/', env: { PATH: APP_PATH, HOME: home, NODENV_ROOT: nodenv, XDG_STATE_HOME: home, XDG_CONFIG_HOME: home } });

  test('cmux.json に書く命令の字を、HOME だけを持つ環境の /bin/sh -c で動かせる', () => {
    const { home, nodenv } = sandbox(NODE);
    const link = join(home, 'roster');
    symlinkSync(root, link);
    const command = hookCommand(link, { HOME: home });
    expect(command).toContain('"$HOME/roster/cli/bin/roster"');
    const r = sh(command, home, nodenv);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('roster を入れていない機械（HOME に入口が無い）では、同じ字が {} を返して 0 で終わる', () => {
    const { home: there, nodenv } = sandbox(NODE);
    const command = hookCommand(join(there, 'roster'), { HOME: there });
    const { home } = sandbox();
    const r = sh(command, home, nodenv);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('入口が有って落ちる時は、失敗を隠さない', () => {
    const { home, nodenv } = sandbox();
    const bin = join(home, 'roster', 'cli', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'roster'), '#!/bin/sh\necho boom >&2\nexit 3\n');
    chmodSync(join(bin, 'roster'), 0o755);
    const r = sh(hookCommand(join(home, 'roster'), { HOME: home }), home, nodenv);
    expect(r.status).toBe(3);
    expect(r.stderr).toBe('boom\n');
  });
});

describe('roster banner hook（bin/roster 経由）', () => {
  // 本物の状態・cmux に触らないよう、環境変数は PATH と一時の folder だけにする。
  const run = (input: string) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-cli-')));
    return spawnSync(join(cli, 'bin', 'roster'), ['banner', 'hook'], { input, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, XDG_STATE_HOME: dir, XDG_CONFIG_HOME: dir } });
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

test('banner.jsonl は 7 日より古い行を消す', async () => {
  const { w, hook } = await hooked();
  const file = join(w.tpm.state.dir, 'banner.jsonl');
  writeFileSync(file, `${JSON.stringify({ at: '2026-11-01T00:00:00.000Z', workspace: 'file:1', role: 'x', category: 'turn-complete', show: false, reason: '古い' })}\n`);
  hook('U-SE', 'turn-complete');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain('古い');
});

describe('TPM 担当の roster hello の一言', () => {
  test('cmux の連携で cmux.json に hook が無ければ 1 行出し、あれば出さない。file の連携では見ない', () => {
    const w = world();
    const cmux = { ...w.tpm, config: { ...w.tpm.config, transport: 'cmux' as const } };
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-hint-')));
    const file = join(dir, 'cmux.json');
    expect(bannerHint(w.tpm, file)).toEqual([]);
    expect(bannerHint(cmux, file)).toEqual([expect.stringMatching(/hook がありません。roster banner setup/)]);
    writeFileSync(file, `{ "notifications": { "hooks": [${JSON.stringify(hookEntry(cmux.root, cmux.env))}] } }`);
    expect(bannerHint(cmux, file)).toEqual([]);
    writeFileSync(file, '{ "notifications": { "hooks": [{ "id": "roster-banner", "command": "PATH=/n/bin:/usr/bin:/bin /r/cli/bin/roster banner hook" }] } }');
    expect(bannerHint(cmux, file)).toEqual([expect.stringMatching(/hook の命令が古い形です.*roster banner setup/)]);
    writeFileSync(file, '{ "notifications": { "hooks": [{ "id": "roster-banner", "command": "/elsewhere/cli/bin/roster banner hook" }] } }');
    expect(bannerHint(cmux, file)).toEqual([expect.stringMatching(/hook の命令が今の roster の在り処と違います.*roster banner setup/)]);
    writeFileSync(file, '{ broken');
    expect(bannerHint(cmux, file)).toEqual([expect.stringMatching(/cmux.json を読めません/)]);
  });

  test('cmux の連携で、設定が古い在り処（~/.config/tpm）にあれば 1 行足す', () => {
    const configHome = realpathSync(mkdtempSync(join(tmpdir(), 'roster-banner-hint-old-')));
    const w = world({}, { XDG_CONFIG_HOME: configHome });
    const cmux = { ...w.tpm, config: { ...w.tpm.config, transport: 'cmux' as const } };
    const file = join(configHome, 'cmux.json');
    writeFileSync(file, `{ "notifications": { "hooks": [${JSON.stringify(hookEntry(cmux.root, cmux.env))}] } }`);
    expect(bannerHint(cmux, file)).toEqual([]);
    mkdirSync(join(configHome, 'tpm'));
    writeFileSync(join(configHome, 'tpm', 'banner.jsonc'), '{}');
    expect(bannerHint(cmux, file)).toEqual([expect.stringMatching(/^通知のバナー: 設定が古い在り処にあり、読みません.*mv .*（Product Manager に伝える）$/)]);
    expect(bannerHint(w.tpm, file)).toEqual([]);
  });
});
