// 軽い待ち方（cli/bin/roster-mail-wait。待つ所だけを NATS の CLI に任せる sh）の試験。
// node と nats は、PATH に置いた偽物（sh）に替える: 段（--arm・--check）の exit code と、合図（nats sub）が終わる時を、試験が決める。
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const cli = realpathSync(join(import.meta.dirname, '..'));
const script = join(cli, 'bin', 'roster-mail-wait');
const entry = join(cli, 'bin', 'roster');

/** 偽の node: 引数を calls に 1 行で書き、stdin を stdin.<段> に写し、段ごとに決めた exit code で終わる。 */
const FAKE_NODE = `#!/bin/sh
dir=$(dirname "$0")
echo "$*" >> "$dir/calls"
case "$*" in
  *--arm*) cat > "$dir/stdin.arm"; cat "$dir/arm.out" 2>/dev/null; exit "$(cat "$dir/arm.code")" ;;
  *--check*)
    cat > "$dir/stdin.check"
    n=$(cat "$dir/check.n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$dir/check.n"
    code=$(sed -n "\${n}p" "$dir/check.codes"); [ -n "$code" ] || code=$(tail -n 1 "$dir/check.codes")
    if [ "$code" = 2 ]; then echo '渡した本文' >&2; fi
    exit "$code" ;;
  *) cat > "$dir/stdin.heavy"; echo 'Node.js で待った' >&2; exit "$(cat "$dir/heavy.code" 2>/dev/null || echo 0)" ;;
esac
`;

/** 偽の nats: 自分の pid と引数を書き、signal の file ができるまで待って 0 で終わる（fail の file があれば、すぐ 1 で終わる）。 */
const FAKE_NATS = `#!/bin/sh
dir=$(dirname "$0")
echo "$$ $*" >> "$dir/nats.calls"
if [ -e "$dir/fail" ]; then exit 1; fi
while [ ! -e "$dir/signal" ]; do sleep 0.05; done
rm -f "$dir/signal"
exit 0
`;

interface Fake {
  dir: string
  /** 待つ者の印の file。 */
  mark: string
  env: NodeJS.ProcessEnv
  calls: () => string[]
  natsCalls: () => string[]
}

const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill('SIGKILL');
});

/** 偽の node と nats を置いた folder。arm は --arm の exit code、checks は --check の exit code の並び（終わりの値をくり返す）。claude は、居る事にする pid。 */
function fake(options: { arm: number, checks?: number[], claude?: number, nats?: boolean }): Fake {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-wait-sh-')));
  const put = (name: string, body: string): void => {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  };
  put('node', FAKE_NODE);
  if (options.nats !== false) put('nats', FAKE_NATS);
  mkdirSync(join(dir, 'state'));
  const mark = join(dir, 'state', 'waiter.jsonc');
  writeFileSync(mark, '{"pid":1}');
  writeFileSync(join(dir, 'arm.code'), String(options.arm));
  writeFileSync(join(dir, 'arm.out'), `${options.claude ?? process.pid}\t${mark}\tnats://127.0.0.1:1\troster.test.msg.t-x7k2\n`);
  writeFileSync(join(dir, 'check.codes'), `${(options.checks ?? [10]).join('\n')}\n`);
  const lines = (name: string): string[] => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').split('\n').filter(l => l !== '') : [];
  return {
    dir,
    mark,
    // roster の環境変数は渡さない（本物の状態を読まない）。nats は、偽物の path を名指す（機械に本物があっても使わない）。
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, ROSTER_NATS_CLI: options.nats === false ? 'none' : join(dir, 'nats'), ROSTER_MAIL_TICK_SECONDS: '0.05' },
    calls: () => lines('calls'),
    natsCalls: () => lines('nats.calls'),
  };
}

/** sh を動かし、終わるまで待つ（長くて ms）。 */
function start(f: Fake, extra: NodeJS.ProcessEnv = {}): { child: ChildProcess, done: Promise<{ code: number | null, stderr: string }> } {
  const child = spawn(script, ['/repo/cli/src/cli.ts'], { env: { ...f.env, ...extra }, stdio: ['pipe', 'ignore', 'pipe'] });
  running.push(child);
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  child.stdin?.end('{"session_id":"s-1"}');
  const done = new Promise<{ code: number | null, stderr: string }>((resolve) => {
    child.on('close', code => resolve({ code, stderr }));
  });
  return { child, done };
}

/** cond が真になるまで待つ（長くて 5 秒）。 */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(resolve => setTimeout(resolve, 50));
  expect(cond()).toBe(true);
}

/** その pid の process が居るか。 */
const alive = (pid: number): boolean => spawnSync('kill', ['-0', String(pid)]).status === 0;
const natsPid = (f: Fake): number => Number(f.natsCalls().at(-1)?.split(' ')[0]);

describe('軽い待ち方（roster-mail-wait）', () => {
  test('NATS の CLI を使わない機械では、今までどおり Node.js で待つ（exec node … mail wait）', async () => {
    const f = fake({ arm: 10, nats: false });
    writeFileSync(join(f.dir, 'heavy.code'), '2');
    const { code, stderr } = await start(f).done;
    expect(f.calls()).toEqual(['/repo/cli/src/cli.ts mail wait']);
    expect(code).toBe(2);
    expect(stderr).toContain('Node.js で待った');
    expect(readFileSync(join(f.dir, 'stdin.heavy'), 'utf8')).toBe('{"session_id":"s-1"}');
  });

  test('cli/bin/roster は、引数の無い mail wait だけを、軽い待ち方に回す', () => {
    const f = fake({ arm: 0 });
    const at = (args: string[]) => spawnSync(entry, args, { env: f.env, input: '{}', encoding: 'utf8' });
    at(['mail', 'wait']);
    at(['mail', 'wait', '--check', '--waiter', '7']);
    at(['mail', 'gate']);
    const js = join(cli, 'src', 'cli.ts');
    expect(f.calls()).toEqual([`${js} mail wait --arm --waiter ${f.calls()[0]?.split(' ').at(-1) ?? ''}`, `${js} mail wait --check --waiter 7`, `${js} mail gate`]);
  });

  test('構えられない時（手伝いの中・名乗れない）は、何も聞かずに 0 で終わる', async () => {
    const f = fake({ arm: 0 });
    const { code, stderr } = await start(f).done;
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(f.natsCalls()).toEqual([]);
  });

  test('配りの口が合図の在り処を持たない時（12）は、Node.js で待つ', async () => {
    const f = fake({ arm: 12 });
    writeFileSync(join(f.dir, 'heavy.code'), '2');
    const { code } = await start(f).done;
    expect(code).toBe(2);
    expect(f.calls().at(-1)).toBe('/repo/cli/src/cli.ts mail wait');
    expect(f.natsCalls()).toEqual([]);
  });

  test('もう自分宛てがあれば、聞き始めた後の 1 度目の見るで渡して 2 で終わる（聞く process は残さない・印は消す）', async () => {
    const f = fake({ arm: 10, checks: [2] });
    const { child, done } = start(f);
    // 印は、構えた段（本物は node）が、この sh の pid で書く。
    writeFileSync(f.mark, `{"pid":${child.pid ?? 0}}`);
    const { code, stderr } = await done;
    expect(code).toBe(2);
    expect(stderr).toBe('渡した本文\n');
    expect(f.natsCalls()).toHaveLength(1);
    expect(f.natsCalls()[0]).toMatch(/ --server nats:\/\/127\.0\.0\.1:1 sub roster\.test\.msg\.t-x7k2 --count 1$/);
    expect(alive(natsPid(f))).toBe(false);
    expect(existsSync(f.mark)).toBe(false);
    expect(readFileSync(join(f.dir, 'stdin.check'), 'utf8')).toBe('{"session_id":"s-1"}');
  });

  test('無ければ合図を待ち、合図が来たら見て渡す（待つ間は node を動かさない）', async () => {
    const f = fake({ arm: 10, checks: [10, 2] });
    const { done } = start(f);
    await until(() => f.calls().length === 2);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(f.calls()).toHaveLength(2);
    writeFileSync(join(f.dir, 'signal'), '');
    const { code, stderr } = await done;
    expect(code).toBe(2);
    expect(stderr).toBe('渡した本文\n');
    expect(f.calls().filter(c => c.includes('--check'))).toHaveLength(2);
    // 見るたびに、先に聞き始めている。
    expect(f.natsCalls()).toHaveLength(2);
  });

  test('止める合図（SIGTERM）で、聞く process を止めて 0 で終わる（印が自分のままなら消す。書き替えられた印は、印が自分でなくなった時の試験）', async () => {
    const f = fake({ arm: 10 });
    const { child, done } = start(f);
    await until(() => f.calls().length === 2 && f.natsCalls().length === 1);
    const pid = natsPid(f);
    expect(alive(pid)).toBe(true);
    child.kill('SIGTERM');
    const { code, stderr } = await done;
    expect(code).toBe(0);
    expect(stderr).toBe('');
    await until(() => !alive(pid));
    expect(existsSync(f.mark)).toBe(false);
  });

  test('印が自分でなくなったら（次の待つ命令に替わった）、0 で終わる', async () => {
    const f = fake({ arm: 10 });
    const { done } = start(f);
    await until(() => f.calls().length === 2 && f.natsCalls().length === 1);
    const pid = natsPid(f);
    writeFileSync(f.mark, '{"pid":999999}');
    expect((await done).code).toBe(0);
    await until(() => !alive(pid));
    expect(readFileSync(f.mark, 'utf8')).toBe('{"pid":999999}');
  });

  test('Claude Code が居なくなったら、0 で終わる（印は消す）', async () => {
    const sleeper = spawn('sleep', ['30']);
    running.push(sleeper);
    const f = fake({ arm: 10, claude: sleeper.pid ?? 0 });
    const { done } = start(f);
    await until(() => f.calls().length === 2 && f.natsCalls().length === 1);
    const pid = natsPid(f);
    sleeper.kill('SIGKILL');
    expect((await done).code).toBe(0);
    await until(() => !alive(pid));
    expect(existsSync(f.mark)).toBe(false);
  });

  test('配りの口が応えない間（11）は、間を空けて試し直し、起こさない', async () => {
    const f = fake({ arm: 10, checks: [11, 2] });
    const began = Date.now();
    const { code } = await start(f).done;
    expect(code).toBe(2);
    expect(f.calls().filter(c => c.includes('--check'))).toHaveLength(2);
    // 1 度目の試し直しの間は 1 秒。
    expect(Date.now() - began).toBeGreaterThanOrEqual(1000);
  });

  test('見直しの時が来たら、聞き直して見る（合図を取りこぼしても拾う）', async () => {
    const f = fake({ arm: 10, checks: [10, 10, 2] });
    const { code } = await start(f, { ROSTER_MAIL_RECHECK_TICKS: '2' }).done;
    expect(code).toBe(2);
    expect(f.calls().filter(c => c.includes('--check'))).toHaveLength(3);
    expect(f.natsCalls()).toHaveLength(3);
  });

  test('合図が来たのに何も無い（空振り）が続いたら、5 度で 0 で終わる（回り続けない）', async () => {
    const f = fake({ arm: 10, checks: [10] });
    // 偽の nats を、すぐ 0 で終わる物に替える（聞く process が、合図も無いのに終わってしまう形）。
    writeFileSync(join(f.dir, 'nats'), '#!/bin/sh\necho "$$ $*" >> "$(dirname "$0")/nats.calls"\nexit 0\n');
    const { code, stderr } = await start(f).done;
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(f.calls().filter(c => c.includes('--check'))).toHaveLength(6);
  }, 20_000);

  test('段が知らない code で終わったら、0 で終わる（回り続けない）', async () => {
    const f = fake({ arm: 10, checks: [1] });
    const { code } = await start(f).done;
    expect(code).toBe(0);
    expect(f.calls()).toHaveLength(2);
  });
});
