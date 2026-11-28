// roster chrome …: 担当が手元で Chrome を起こす、ただ 1 つの道（run・start・list・stop）。
// いつも keychain を読ませない旗を付け（src/chrome.ts）、profile は roster が作って片付ける。
// 裏で起こした物は state の chrome.jsonl に、起こした行と止めた行を足していく（台帳 #402・#403・#404）。
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkChromeArgs, chromeArgs, DEVTOOLS_PORT_FILE, flagValue, normalizeChromeArgs, readDevToolsPort, readListeningPort, resolveChrome } from '../chrome.ts';
import type { Context } from '../context.ts';
import { envOf } from '../env.ts';
import { TpmError } from '../skill-sets.ts';

/** 起こした・止めた記録の file（state の中）。 */
export const CHROME_RECORD = 'chrome.jsonl';
/** 裏で起こした Chrome が CDP の口を書くのを待つ長さ（ms）。 */
const PORT_WAIT_MS = 10_000;
/** SIGTERM の後、居なくなるのを待つ長さ（ms）。過ぎたら SIGKILL。 */
const STOP_WAIT_MS = 5_000;
/** 待つ間に見直す間（ms）。 */
const POLL_MS = 200;
/** 前で動かす時の既定の長さ（秒）。 */
export const RUN_TIMEOUT_SECONDS = 60;

/** Chrome の process を起こす・見る・止める口（試験で替える）。 */
export interface ChromeOps {
  /** 裏で起こし、pid を返す。標準出力・標準エラーは log の file へ。 */
  spawnDetached(exe: string, args: string[], log: string): number
  /** 前で動かし、終わるか timeoutMs を過ぎるまで待つ。過ぎたら止めて timedOut。 */
  run(exe: string, args: string[], timeoutMs: number): { status: number, stdout: string, stderr: string, timedOut: boolean }
  /** pid の process の command line。居なければ undefined。 */
  commandLine(pid: number): string | undefined
  /** profile を使う process（command line に profile の path があり、その後ろが /・空白・終わり）の pid（自分は除く）。 */
  pidsUsing(profile: string): number[]
  /** file が在るか。 */
  exists(path: string): boolean
  /** 合図を送る。もう居なくても誤りにしない。 */
  signal(pid: number, sig: 'SIGTERM' | 'SIGKILL'): void
}

/** 正規表現の特別な字を逃がす（pgrep -f に字のまま当てるため）。 */
const escapeRegExp = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * command line が profile を使っているか。path の前が頭・空白・=、後ろが /・空白・終わりの時だけ当てる（`/tmp/p` で `/x/tmp/p` に当てない。review-4 の提案 1）（`/tmp/p` で `/tmp/p2` に当てない。
 * chrome_crashpad_handler の `--database=<profile>/Crashpad` の形にも当たる。review-3 の指摘 3）。
 */
export const usesProfile = (line: string, profile: string): boolean => new RegExp(`(?:^|[ =])${escapeRegExp(profile)}(?:/| |$)`).test(line);

/** 本物の口。 */
export const realChromeOps: ChromeOps = {
  spawnDetached(exe, args, log) {
    const fd = openSync(log, 'a');
    try {
      const child = spawn(exe, args, { detached: true, stdio: ['ignore', fd, fd] });
      // 起こせなかった誤り（ENOENT など）は後で知らせとして来る。受け手が無いと node ごと落ちるので受ける（pid が無いので下で断る）。
      child.on('error', () => undefined);
      child.unref();
      if (child.pid === undefined) throw new TpmError(`Chrome を起こせません: ${exe}`);
      return child.pid;
    }
    finally {
      closeSync(fd);
    }
  },
  run(exe, args, timeoutMs) {
    const r = spawnSync(exe, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 64 * 1024 * 1024 });
    const code = r.error !== undefined && 'code' in r.error ? String(r.error.code) : undefined;
    if (r.error !== undefined && code !== 'ETIMEDOUT') return { status: 127, stdout: '', stderr: r.error.message, timedOut: false };
    const timedOut = code === 'ETIMEDOUT' || (r.status === null && r.signal === 'SIGTERM');
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
  },
  commandLine(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    try {
      const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
      return out === '' ? undefined : out;
    }
    catch {
      return undefined;
    }
  },
  pidsUsing(profile) {
    try {
      const out = execFileSync('pgrep', ['-f', '--', `(^|[ =])${escapeRegExp(profile)}(/| |$)`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
      return out.split('\n').map(Number).filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    }
    catch {
      return [];
    }
  },
  exists: path => existsSync(path),
  signal(pid, sig) {
    try {
      process.kill(pid, sig);
    }
    catch {
      // もう居ない。
    }
  },
};

/** 起こした行・止めた行。 */
export type ChromeRecord =
  | { event: 'start', at: string, pid: number, key: string | undefined, exe: string, profile: string, ownProfile: boolean, log: string, port: number }
  | { event: 'stop', at: string, pid: number, profile: string };

/** 起こした行。 */
type StartRecord = Extract<ChromeRecord, { event: 'start' }>;

/** run・start の求め。 */
export interface ChromeOptions {
  bin?: string
  headed?: boolean
  profile?: string
  port?: number
  timeout?: number
}

/** 起こす前の支度: Chrome を選んで在るかを見る・使わせない旗を見る・profile を決める（渡されなければ一時の folder を作り、roster が片付ける）。 */
function prepare(ctx: Context, args: string[], options: ChromeOptions, ops: ChromeOps, port?: number): { exe: string, profile: string, own: boolean, full: string[] } {
  const exe = resolveChrome(options.bin, ctx.env);
  if (!ops.exists(exe)) throw new TpmError(`Chrome がありません: ${exe}（--bin か $ROSTER_CHROME で在り処を渡す）`);
  const launch = { args, ...(options.headed === true ? { headed: true } : {}), ...(port === undefined ? {} : { port }) };
  if (options.profile !== undefined) {
    const profile = resolve(options.profile);
    // 動いている Chrome と同じ profile で起こすと、新しい Chrome は前の Chrome に渡して直ぐ終わり、後の片付けが前の Chrome を止める（review-3 の指摘 3）。
    if (ops.pidsUsing(profile).length > 0) throw new TpmError(`--profile ${profile} は、動いている process が使っています（roster chrome list・pgrep -fl で見る）。別の folder を渡してください`);
    return { exe, profile, own: false, full: chromeArgs({ ...launch, profile }) };
  }
  // 旗は、一時の folder を作る前に見る（断った時に folder を残さない。review-3 の指摘 5）。
  checkChromeArgs({ ...launch, profile: tmpdir() });
  const key = (envOf(ctx.env, 'KEY') ?? 'x').replaceAll(/[^A-Za-z0-9.-]/g, '-');
  const profile = mkdtempSync(join(tmpdir(), `roster-chrome-${key}-`));
  return { exe, profile, own: true, full: chromeArgs({ ...launch, profile }) };
}

/** 待つ（ctx.sleep で。試験は待たない）。 */
async function waitUntil(ctx: Context, ms: number, done: () => boolean): Promise<boolean> {
  for (let waited = 0; ; waited += POLL_MS) {
    if (done()) return true;
    if (waited >= ms) return false;
    await ctx.sleep(POLL_MS);
  }
}

/**
 * 親が居なくなった後に、profile を command line に持つ残り（Renderer・GPU の helper・chrome_crashpad_handler）を pid で止め、
 * roster の作った profile を消す（親が居るうちに消すと、Chrome が書き戻して folder が残る）。
 */
async function tidyUp(ctx: Context, ops: ChromeOps, profile: string, own: boolean): Promise<void> {
  const using = (pid: number): boolean => usesProfile(ops.commandLine(pid) ?? '', profile);
  const rest = ops.pidsUsing(profile);
  for (const pid of rest) ops.signal(pid, 'SIGTERM');
  if (!await waitUntil(ctx, STOP_WAIT_MS, () => !rest.some(using))) {
    for (const pid of rest) if (using(pid)) ops.signal(pid, 'SIGKILL');
  }
  if (own) {
    rmSync(profile, { recursive: true, force: true });
    rmSync(`${profile}.log`, { force: true });
  }
}

/** roster chrome run: 前で動かし、終わるまで待つ（撮り・--dump-dom）。Chrome の出力と終了コードを返す。 */
export async function chromeRun(ctx: Context, args: string[], options: ChromeOptions, ops: ChromeOps = realChromeOps): Promise<{ status: number, stdout: string, stderr: string }> {
  const { exe, profile, own, full } = prepare(ctx, args, options, ops);
  try {
    const seconds = options.timeout ?? RUN_TIMEOUT_SECONDS;
    const r = ops.run(exe, full, seconds * 1000);
    if (r.timedOut) return { status: 1, stdout: r.stdout, stderr: `${r.stderr}roster chrome: ${seconds} 秒を過ぎたので止めました（--timeout で替える）\n` };
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  finally {
    await tidyUp(ctx, ops, profile, own);
  }
}

/** 記録を読む。 */
const records = (ctx: Context): ChromeRecord[] => ctx.state.lines<ChromeRecord>(CHROME_RECORD);

/**
 * 「まだ動いている」の判じ（list・stop・pid の使い回しの検査は、みなこれを使う）:
 * 止めた行が無く、pid が居て、その command line に、起こした時の profile がある。
 */
export function aliveStarts(all: ChromeRecord[], ops: ChromeOps): StartRecord[] {
  const stopped = new Set(all.filter(r => r.event === 'stop').map(r => `${r.pid} ${r.profile}`));
  return all.filter((r): r is StartRecord => r.event === 'start')
    .filter(r => !stopped.has(`${r.pid} ${r.profile}`))
    .filter(r => usesProfile(ops.commandLine(r.pid) ?? '', r.profile));
}

/** roster chrome start: 裏で起こし、pid・CDP の URL・profile・log を出す。 */
export async function chromeStart(ctx: Context, args: string[], options: ChromeOptions, ops: ChromeOps = realChromeOps): Promise<string[]> {
  // --port が無く、担当が Chrome の引数に口を書いていれば、その口を使う（0 を足さない。review-3 の指摘 4）。
  const written = flagValue(normalizeChromeArgs(args), '--remote-debugging-port');
  const { exe, profile, own, full } = prepare(ctx, args, options, ops, options.port ?? (written === undefined ? 0 : undefined));
  const log = `${profile}.log`;
  const since = ctx.now().getTime();
  // log は足していくので、起こす前の大きさから後ろだけを読む（前の回の行を読まない）。
  const offset = existsSync(log) ? statSync(log).size : 0;
  let pid: number;
  try {
    // 前に落ちた Chrome の口を読まないように、起こす前に消す（読むのも、起こした時刻より新しい物だけ）。
    rmSync(join(profile, DEVTOOLS_PORT_FILE), { force: true });
    pid = ops.spawnDetached(exe, full, log);
  }
  catch (e) {
    if (own) {
      rmSync(profile, { recursive: true, force: true });
      // spawnDetached が開いた log も消す（review-4 の提案 2）。
      rmSync(log, { force: true });
    }
    throw e;
  }
  let port: number | undefined;
  const up = await waitUntil(ctx, PORT_WAIT_MS, () => {
    // 口 0 なら DevToolsActivePort、口を決めたなら log の「DevTools listening on」で知る（Chrome は口を決めると file を書かない）。
    port = readDevToolsPort(profile, since) ?? readListeningPort(log, offset);
    return port !== undefined || ops.commandLine(pid) === undefined;
  });
  if (!up || port === undefined) {
    ops.signal(pid, 'SIGTERM');
    await waitUntil(ctx, STOP_WAIT_MS, () => ops.commandLine(pid) === undefined);
    const tail = existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n').slice(-5) : [];
    await tidyUp(ctx, ops, profile, own);
    throw new TpmError([`Chrome（pid ${pid}）が CDP の口を開きませんでした（10 秒）。止めて片付けました。log の終わり:`, ...tail.map(l => `  ${l}`)].join('\n'));
  }
  ctx.state.append(CHROME_RECORD, { event: 'start', at: new Date(since).toISOString(), pid, key: envOf(ctx.env, 'KEY'), exe, profile, ownProfile: own, log, port } satisfies ChromeRecord);
  return [
    `起こした: pid ${pid}（${exe}）`,
    `CDP: http://127.0.0.1:${port}`,
    `profile: ${profile}`,
    `log: ${log}`,
    `止める: roster chrome stop ${pid}`,
  ];
}

/** roster chrome list: 自分の Key が start で起こし、まだ動いている物（Key が無ければ、みな）。 */
export function chromeList(ctx: Context, ops: ChromeOps = realChromeOps): string[] {
  const key = envOf(ctx.env, 'KEY');
  const alive = aliveStarts(records(ctx), ops).filter(r => key === undefined || r.key === key);
  if (alive.length === 0) return ['動いている Chrome は無い'];
  return alive.map(r => `pid ${r.pid}  CDP http://127.0.0.1:${r.port}  ${r.at}  profile ${r.profile}${key === undefined ? `  Key ${r.key ?? '-'}` : ''}`);
}

/**
 * roster chrome stop: start で起こし、まだ動いている物だけを止める。
 * SIGTERM を送り、5 秒で居なくならなければ SIGKILL。親が居なくなってから、残りの子を pid で止め、roster の作った profile を消す。
 */
export async function chromeStop(ctx: Context, pids: number[], ops: ChromeOps = realChromeOps): Promise<string[]> {
  const alive = aliveStarts(records(ctx), ops);
  const targets = pids.map((pid) => {
    const r = alive.findLast(a => a.pid === pid);
    if (r === undefined) throw new TpmError(`pid ${pid} は、roster chrome start で起こして動いている Chrome ではありません（roster chrome list で見る）。ほかの process は、pgrep -fl '<型>' で pid と command line を見てから kill <pid> で止めてください`);
    return r;
  });
  const lines: string[] = [];
  for (const r of targets) {
    ops.signal(r.pid, 'SIGTERM');
    if (!await waitUntil(ctx, STOP_WAIT_MS, () => ops.commandLine(r.pid) === undefined)) {
      ops.signal(r.pid, 'SIGKILL');
      await waitUntil(ctx, STOP_WAIT_MS, () => ops.commandLine(r.pid) === undefined);
    }
    await tidyUp(ctx, ops, r.profile, r.ownProfile);
    ctx.state.append(CHROME_RECORD, { event: 'stop', at: ctx.now().toISOString(), pid: r.pid, profile: r.profile } satisfies ChromeRecord);
    lines.push(`止めた: pid ${r.pid}${r.ownProfile ? `（profile ${r.profile} を消した）` : ''}`);
  }
  return lines;
}
