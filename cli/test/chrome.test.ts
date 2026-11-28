import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ALWAYS_FLAGS, chromeArgs, readDevToolsPort, readListeningPort, resolveChrome } from '../src/chrome.ts';
import { CHROME_RECORD, chromeList, chromeRun, chromeStart, chromeStop, usesProfile, type ChromeOps, type ChromeRecord } from '../src/commands/chrome.ts';
import type { Context } from '../src/context.ts';
import { world } from './helpers.ts';

const temp = (name: string): string => realpathSync(mkdtempSync(join(tmpdir(), `roster-chrome-test-${name}-`)));

describe('旗の組み（src/chrome.ts）', () => {
  const home = temp('home');
  const profile = join(temp('p'), 'profile');

  test('いつもの旗を前に置き、headless・profile の後ろに担当の引数を置く', () => {
    expect(chromeArgs({ args: ['--screenshot=/x.png', 'https://example.com'], profile }, home)).toEqual([
      '--use-mock-keychain',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--screenshot=/x.png',
      'https://example.com',
    ]);
    expect(ALWAYS_FLAGS.slice(0, 2)).toEqual(['--use-mock-keychain', '--password-store=basic']);
  });

  test('担当が --headless を書けば足さない。--headed なら付けない。両方は断る', () => {
    expect(chromeArgs({ args: ['--headless=old'], profile }, home).filter(a => a.startsWith('--headless'))).toEqual(['--headless=old']);
    expect(chromeArgs({ args: [], profile, headed: true }, home).some(a => a.startsWith('--headless'))).toBe(false);
    expect(() => chromeArgs({ args: ['--headless'], profile, headed: true }, home)).toThrow('--headed と、Chrome の引数の --headless が両方あります');
  });

  test('CDP の口: --port を渡せば足す。担当が同じ値を書いていれば重ねない。違えば断る', () => {
    expect(chromeArgs({ args: [], profile, port: 0 }, home)).toContain('--remote-debugging-port=0');
    expect(chromeArgs({ args: ['--remote-debugging-port=19555'], profile, port: 19555 }, home).filter(a => a.startsWith('--remote-debugging-port'))).toEqual(['--remote-debugging-port=19555']);
    expect(() => chromeArgs({ args: ['--remote-debugging-port=19555'], profile, port: 0 }, home)).toThrow('--port 0 と、Chrome の引数の --remote-debugging-port=19555 が違います');
  });

  test('使わせない旗を断る', () => {
    expect(() => chromeArgs({ args: ['--password-store=keychain'], profile }, home)).toThrow('--password-store=keychain は使えません');
    expect(() => chromeArgs({ args: ['--user-data-dir=/tmp/x'], profile }, home)).toThrow('--user-data-dir は Chrome の引数に書かず');
    expect(() => chromeArgs({ args: ['--profile-directory=Default'], profile }, home)).toThrow('--profile-directory は使えません');
    expect(() => chromeArgs({ args: ['--remote-debugging-address=0.0.0.0'], profile }, home)).toThrow('--remote-debugging-address=0.0.0.0 は使えません');
    expect(chromeArgs({ args: ['--remote-debugging-address=127.0.0.1'], profile }, home)).toContain('--remote-debugging-address=127.0.0.1');
  });

  test('1 本の - の旗も -- の形に揃えて見て、揃えた形を Chrome に渡す（review-3 の指摘 1）', () => {
    expect(() => chromeArgs({ args: ['-password-store=keychain'], profile }, home)).toThrow('--password-store=keychain は使えません');
    expect(() => chromeArgs({ args: ['-user-data-dir=/tmp/x'], profile }, home)).toThrow('--user-data-dir は Chrome の引数に書かず');
    expect(() => chromeArgs({ args: ['-profile-directory=Default'], profile }, home)).toThrow('--profile-directory は使えません');
    expect(() => chromeArgs({ args: ['-remote-debugging-address=0.0.0.0'], profile }, home)).toThrow('--remote-debugging-address=0.0.0.0 は使えません');
    expect(chromeArgs({ args: ['-headless', '-window-size=900,700', 'https://example.com'], profile }, home)).toEqual([
      '--use-mock-keychain',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--headless',
      '--window-size=900,700',
      'https://example.com',
    ]);
  });

  test('profile が ~/Library/Application Support の下なら断る（symlink を通しても。まだ無い folder でも）', () => {
    const support = join(home, 'Library', 'Application Support');
    mkdirSync(join(support, 'Google', 'Chrome'), { recursive: true });
    expect(() => chromeArgs({ args: [], profile: join(support, 'Google', 'Chrome') }, home)).toThrow('Product Manager のふだんのブラウザの profile');
    expect(() => chromeArgs({ args: [], profile: join(support, 'Chromium', 'new') }, home)).toThrow('Product Manager のふだんのブラウザの profile');
    const link = join(temp('link'), 'chrome');
    symlinkSync(join(support, 'Google'), link);
    expect(() => chromeArgs({ args: [], profile: join(link, 'Chrome') }, home)).toThrow('Product Manager のふだんのブラウザの profile');
    // macOS の既定の file system は大小を分けない（review-3 の指摘 2）。
    expect(() => chromeArgs({ args: [], profile: join(home, 'library', 'application support', 'Google', 'Chrome') }, home)).toThrow('Product Manager のふだんのブラウザの profile');
  });
});

describe('バイナリの選び（resolveChrome）', () => {
  /** puppeteer の置き場を真似た home（版ごとに Chrome for Testing を置く）。 */
  function puppeteerHome(versions: string[]): string {
    const home = temp('pp');
    for (const v of versions) {
      const dir = join(home, '.cache', 'puppeteer', 'chrome', `mac_arm-${v}`, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'Google Chrome for Testing'), '');
    }
    return home;
  }

  test('既定は $ROSTER_CHROME、無ければ Google Chrome。.app は中の実行の file に読み替える', () => {
    expect(resolveChrome(undefined, {})).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(resolveChrome(undefined, { ROSTER_CHROME: '/opt/chromium/chromium' })).toBe('/opt/chromium/chromium');
    expect(resolveChrome('/Applications/Chromium.app/', {})).toBe('/Applications/Chromium.app/Contents/MacOS/Chromium');
  });

  test('for-testing は、いちばん新しい版。@ で版の頭を絞る', () => {
    const home = puppeteerHome(['155.0.7000.1', '156.0.8078.47', '99.0.1.1']);
    expect(resolveChrome('for-testing', {}, home)).toContain('mac_arm-156.0.8078.47');
    expect(resolveChrome('for-testing@155', {}, home)).toContain('mac_arm-155.0.7000.1');
    expect(() => resolveChrome('for-testing@157', {}, home)).toThrow('Chrome for Testing 157 が');
  });

  test('Chrome の仲間でない名は断る', () => {
    expect(() => resolveChrome('/bin/sh', {})).toThrow('--bin が Chrome の仲間ではありません');
  });
});

describe('DevToolsActivePort（readDevToolsPort）', () => {
  test('起こした時刻より古い file は、前に落ちた Chrome の残りとして読まない', () => {
    const profile = temp('dt');
    writeFileSync(join(profile, 'DevToolsActivePort'), '19555\n/devtools/browser/x\n');
    const old = new Date('2026-11-01T00:00:00Z');
    utimesSync(join(profile, 'DevToolsActivePort'), old, old);
    expect(readDevToolsPort(profile, Date.parse('2026-11-20T00:00:00Z'))).toBeUndefined();
    expect(readDevToolsPort(profile, old.getTime())).toBe(19555);
  });
});

/** Chrome の process の偽物。起こすと親と helper を 1 つ置き、DevToolsActivePort を書く。 */
function fakeOps(options: { port?: number, stubborn?: boolean, helperStays?: boolean, writesPort?: boolean } = {}): ChromeOps & { procs: Map<number, string>, signals: string[], runs: string[][] } {
  const procs = new Map<number, string>();
  const signals: string[] = [];
  const runs: string[][] = [];
  let next = 5000;
  const profileOf = (args: string[]): string => args.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? '';
  return {
    procs,
    signals,
    runs,
    spawnDetached(exe, args, log) {
      const pid = next += 1;
      procs.set(pid, `${exe} ${args.join(' ')}`);
      procs.set(next += 1, `${exe} Helper --type=renderer --user-data-dir=${profileOf(args)}`);
      // 本物と同じく、口 0 なら DevToolsActivePort を書き、口を決めたなら log に「DevTools listening on」だけを書く。
      const fixed = args.find(a => a.startsWith('--remote-debugging-port='))?.slice('--remote-debugging-port='.length);
      if (options.writesPort !== false) {
        if (fixed === undefined || fixed === '0') writeFileSync(join(profileOf(args), 'DevToolsActivePort'), `${String(options.port ?? 9333)}\n/devtools/browser/x\n`);
        else appendFileSync(log, `DevTools listening on ws://127.0.0.1:${fixed}/devtools/browser/x\n`);
      }
      return pid;
    },
    run(exe, args) {
      runs.push([exe, ...args]);
      procs.set(next += 1, `chrome_crashpad_handler --user-data-dir=${profileOf(args)}`);
      return { status: 0, stdout: 'out', stderr: '', timedOut: false };
    },
    commandLine: pid => procs.get(pid),
    pidsUsing: profile => [...procs].filter(([, line]) => usesProfile(line, profile)).map(([pid]) => pid),
    exists: path => !path.includes('missing'),
    signal(pid, sig) {
      signals.push(`${sig} ${pid}`);
      const line = procs.get(pid) ?? '';
      const helper = line.includes('Helper') || line.includes('crashpad');
      if (sig === 'SIGKILL' || (!options.stubborn && !(helper && options.helperStays === true))) procs.delete(pid);
    },
  };
}

describe('roster chrome start・list・stop', () => {
  /** 担当の周り（Key は t-x）。 */
  const seat = (): Context => world().role('t-x', 'file:x');
  const recordsOf = (ctx: Context): ChromeRecord[] => ctx.state.lines<ChromeRecord>(CHROME_RECORD);

  test('start: 旗を付けて裏で起こし、CDP の URL を出して記録する。前に残った DevToolsActivePort は消してから起こす', async () => {
    const ctx = seat();
    const ops = fakeOps({ port: 41234 });
    const profile = temp('given');
    writeFileSync(join(profile, 'DevToolsActivePort'), '1111\n');
    const lines = await chromeStart(ctx, ['--host-resolver-rules=MAP x 127.0.0.1'], { bin: '/x/Google Chrome for Testing', profile }, ops);
    expect(lines).toContain('CDP: http://127.0.0.1:41234');
    const line = ops.procs.get(5001) ?? '';
    for (const flag of ['--use-mock-keychain', '--password-store=basic', '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`]) expect(line).toContain(flag);
    expect(recordsOf(ctx)).toMatchObject([{ event: 'start', pid: 5001, key: 't-x', profile, ownProfile: false, port: 41234 }]);
  });

  test('start: 口を書かなければ、止めて片付け、誤りにする（記録しない）', async () => {
    const ctx = seat();
    const ops = fakeOps({ writesPort: false });
    await expect(chromeStart(ctx, [], { bin: '/x/chromium' }, ops)).rejects.toThrow('CDP の口を開きませんでした');
    expect(ops.procs.size).toBe(0);
    expect(recordsOf(ctx)).toEqual([]);
  });

  test('list・stop: 動いている物を出し、止めると親・残りの helper を止め、作った profile を消して list から外す', async () => {
    const ctx = seat();
    const ops = fakeOps({ helperStays: true });
    await chromeStart(ctx, [], { bin: '/x/chromium' }, ops);
    const [started] = recordsOf(ctx);
    if (started?.event !== 'start') throw new Error('start の行が無い');
    expect(existsSync(started.profile)).toBe(true);
    expect(chromeList(ctx, ops)[0]).toContain('pid 5001');
    const lines = await chromeStop(ctx, [5001], ops);
    expect(lines[0]).toContain('止めた: pid 5001');
    expect(ops.signals).toEqual(['SIGTERM 5001', 'SIGTERM 5002', 'SIGKILL 5002']);
    expect(ops.procs.size).toBe(0);
    expect(existsSync(started.profile)).toBe(false);
    expect(chromeList(ctx, ops)).toEqual(['動いている Chrome は無い']);
    await expect(chromeStop(ctx, [5001], ops)).rejects.toThrow('pid 5001 は、roster chrome start で起こして動いている Chrome ではありません');
  });

  test('stop: SIGTERM で居なくならなければ SIGKILL。渡した profile は消さない', async () => {
    const ctx = seat();
    const ops = fakeOps({ stubborn: true });
    const profile = temp('keep');
    await chromeStart(ctx, [], { bin: '/x/chromium', profile }, ops);
    await chromeStop(ctx, [5001], ops);
    expect(ops.signals.slice(0, 2)).toEqual(['SIGTERM 5001', 'SIGKILL 5001']);
    expect(existsSync(profile)).toBe(true);
  });

  test('stop: 記録に無い pid と、pid が使い回されて command line に profile が無い物は断る', async () => {
    const ctx = seat();
    const ops = fakeOps();
    await chromeStart(ctx, [], { bin: '/x/chromium' }, ops);
    await expect(chromeStop(ctx, [4242], ops)).rejects.toThrow('pid 4242 は');
    ops.procs.set(5001, '/usr/bin/vim notes.txt');
    await expect(chromeStop(ctx, [5001], ops)).rejects.toThrow('pid 5001 は');
    expect(ops.signals).toEqual([]);
    expect(chromeList(ctx, ops)).toEqual(['動いている Chrome は無い']);
  });

  test('list: ほかの Key の物は出さない', async () => {
    const w = world();
    const ops = fakeOps();
    await chromeStart(w.role('t-y', 'file:y'), [], { bin: '/x/chromium' }, ops);
    expect(chromeList(w.role('t-x', 'file:x'), ops)).toEqual(['動いている Chrome は無い']);
    expect(chromeList(w.role('t-y', 'file:y'), ops)[0]).toContain('pid 5001');
  });
});

describe('口を決めて起こした時の口の読み（Chrome は DevToolsActivePort を書かない）', () => {
  test('log の、起こす前の大きさより後ろの「DevTools listening on」から読む', () => {
    const log = join(temp('log'), 'chrome.log');
    writeFileSync(log, 'DevTools listening on ws://127.0.0.1:1111/devtools/browser/old\n');
    const offset = Buffer.byteLength('DevTools listening on ws://127.0.0.1:1111/devtools/browser/old\n');
    expect(readListeningPort(log, offset)).toBeUndefined();
    appendFileSync(log, '[x] ERROR: something\nDevTools listening on ws://127.0.0.1:19555/devtools/browser/new\n');
    expect(readListeningPort(log, offset)).toBe(19555);
    expect(readListeningPort(join(temp('none'), 'x.log'), 0)).toBeUndefined();
  });

  test('start --port 19555: 前の回の log の行を読まず、新しい行の口を出す', async () => {
    const ctx = world().role('t-x', 'file:x');
    const ops = fakeOps();
    const profile = join(temp('fixed'), 'p');
    mkdirSync(profile);
    writeFileSync(`${profile}.log`, 'DevTools listening on ws://127.0.0.1:1111/devtools/browser/old\n');
    const lines = await chromeStart(ctx, [], { bin: '/x/chromium', profile, port: 19555 }, ops);
    expect(lines).toContain('CDP: http://127.0.0.1:19555');
  });
});

describe('roster chrome の片付けの当て方と支度（review-3）', () => {
  const seat = (key = 't-x'): Context => world().role(key, `file:${key}`);

  test('profile の path の後ろが /・空白・終わりの時だけ当てる', () => {
    expect(usesProfile('chrome --user-data-dir=/tmp/p --headless', '/tmp/p')).toBe(true);
    expect(usesProfile('chrome_crashpad_handler --database=/tmp/p/Crashpad', '/tmp/p')).toBe(true);
    expect(usesProfile('chrome --user-data-dir=/tmp/p', '/tmp/p')).toBe(true);
    expect(usesProfile('chrome --user-data-dir=/tmp/p2 --headless', '/tmp/p')).toBe(false);
  });

  test('stop は、名の似たほかの profile の Chrome に合図を送らない', async () => {
    const ctx = seat();
    const ops = fakeOps();
    const base = temp('near');
    const profile = join(base, 'p');
    mkdirSync(profile);
    ops.procs.set(4000, `/x/chromium --user-data-dir=${join(base, 'p2')}`);
    await chromeStart(ctx, [], { bin: '/x/chromium', profile }, ops);
    await chromeStop(ctx, [5001], ops);
    expect(ops.signals.some(s => s.endsWith(' 4000'))).toBe(false);
    expect(ops.procs.has(4000)).toBe(true);
  });

  test('動いている process が使っている profile では起こさない（前の Chrome を片付けで止めないため）', async () => {
    const ctx = seat();
    const ops = fakeOps();
    const profile = temp('busy');
    ops.procs.set(4000, `/x/chromium --user-data-dir=${profile}`);
    await expect(chromeStart(ctx, [], { bin: '/x/chromium', profile }, ops)).rejects.toThrow('動いている process が使っています');
    await expect(chromeRun(ctx, [], { bin: '/x/chromium', profile }, ops)).rejects.toThrow('動いている process が使っています');
    expect(ops.signals).toEqual([]);
  });

  test('start: --port が無く、Chrome の引数に口があれば、その口を使う（--port 0 で断らない）', async () => {
    const ctx = seat();
    const ops = fakeOps({ port: 19555 });
    const lines = await chromeStart(ctx, ['--remote-debugging-port=19555'], { bin: '/x/chromium' }, ops);
    expect(lines).toContain('CDP: http://127.0.0.1:19555');
    const ports = (ops.procs.get(5001) ?? '').split(' ').filter(a => a.startsWith('--remote-debugging-port'));
    expect(ports).toEqual(['--remote-debugging-port=19555']);
  });

  test('使わせない旗で断った時と、Chrome が無い時は、一時の profile を残さない', async () => {
    const key = `t-left${String(process.pid)}`;
    const ctx = seat(key);
    const left = (): string[] => readdirSync(tmpdir()).filter(n => n.startsWith(`roster-chrome-${key}-`));
    await expect(chromeStart(ctx, ['--password-store=keychain'], { bin: '/x/chromium' }, fakeOps())).rejects.toThrow('使えません');
    await expect(chromeRun(ctx, ['-password-store=keychain'], { bin: '/x/chromium' }, fakeOps())).rejects.toThrow('使えません');
    await expect(chromeStart(ctx, [], { bin: '/missing/chromium' }, fakeOps())).rejects.toThrow('Chrome がありません: /missing/chromium');
    const throwing = {
      ...fakeOps(),
      spawnDetached: (): number => {
        throw new Error('spawn に落ちた');
      },
    };
    await expect(chromeStart(ctx, [], { bin: '/x/chromium' }, throwing)).rejects.toThrow('spawn に落ちた');
    expect(left()).toEqual([]);
  });
});

describe('roster chrome run', () => {
  test('旗を付けて前で動かし、出力を返す。終わったら残りの子を止め、作った profile を消す', async () => {
    const ctx = world().role('t-x', 'file:x');
    const ops = fakeOps();
    const r = await chromeRun(ctx, ['--screenshot=/tmp/a.png', 'file:///a.html'], { bin: '/x/chromium' }, ops);
    expect(r).toEqual({ status: 0, stdout: 'out', stderr: '' });
    const args = ops.runs[0] ?? [];
    expect(args.slice(1, 5)).toEqual(['--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check']);
    const profile = args.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? '';
    expect(profile).toContain('roster-chrome-t-x-');
    expect(existsSync(profile)).toBe(false);
    expect(ops.procs.size).toBe(0);
  });

  test('長さを過ぎたら 1 で終わり、訳を足す。使わせない旗は起こさずに断る', async () => {
    const ctx = world().role('t-x', 'file:x');
    const ops = { ...fakeOps(), run: () => ({ status: 143, stdout: '', stderr: '', timedOut: true }) };
    const r = await chromeRun(ctx, [], { bin: '/x/chromium', timeout: 3 }, ops);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('3 秒を過ぎたので止めました');
    await expect(chromeRun(ctx, ['--password-store=keychain'], { bin: '/x/chromium' }, fakeOps())).rejects.toThrow('--password-store=keychain は使えません');
  });
});
