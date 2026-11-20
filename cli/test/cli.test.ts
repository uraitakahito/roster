// build 済みの cli/dist/cli.js を cli/bin/tpm（sh）経由で動かす。先に pnpm run build が要る。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

/** cli/ の folder（bin/tpm と dist/ がある）と、その 1 つ上の repo。 */
const cli = realpathSync(join(import.meta.dirname, '..'));
const root = join(cli, '..');
const tpm = join(cli, 'bin', 'tpm');
const head = 'claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions';
let scratch: string;

const run = (bin: string, args: string[], cwd: string): string =>
  execFileSync(bin, args, { cwd, encoding: 'utf8' }).trimEnd();
const runFailing = (args: string[]) => spawnSync(tpm, args, { cwd: scratch, encoding: 'utf8' });

// .claude/roles/config.json に text を書いた folder を作る（text が null なら config.json を置かない）
let n = 0;
const folder = (text: string | null): string => {
  const d = join(scratch, `f${n++}`);
  mkdirSync(join(d, '.claude', 'roles'), { recursive: true });
  if (text !== null) writeFileSync(join(d, '.claude', 'roles', 'config.json'), text);
  return d;
};

beforeAll(() => {
  if (!existsSync(join(cli, 'dist', 'cli.js'))) {
    throw new Error('dist/cli.js がありません。先に pnpm run build を打ってください');
  }
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-test-')));
});

describe('tpm が出す 1 行', () => {
  test('folder を渡さなければ今いる folder に cd する', () => {
    expect(run(tpm, [], scratch)).toMatch(new RegExp(`^cd ${scratch} && `));
  });

  test('渡した folder に cd する', () => {
    const d = folder(null);
    expect(run(tpm, [d], root)).toMatch(new RegExp(`^cd ${d} && `));
  });

  test('config.json が無ければ core だけを --add-dir で足し、/tpm の前に -- を置く', () => {
    const d = folder(null);
    expect(run(tpm, [d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets の欄が無ければ core だけ', () => {
    const d = folder('{ "software-engineer": { "effort": "high" } }');
    expect(run(tpm, [d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets に書いた追加の skill セットも足す', () => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    expect(run(tpm, [d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('skill-sets の core と重なりは 1 度だけ足す', () => {
    const d = folder('{ "skill-sets": ["core", "dependabot", "dependabot"] }');
    expect(run(tpm, [d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('symlink から呼んでも repo を正しく求める', () => {
    const link = join(scratch, 'tpm-link');
    symlinkSync(tpm, link);
    expect(run(link, [], scratch)).toMatch(new RegExp(`--add-dir ${root}/skill-sets/core -- /tpm$`));
  });
});

describe('--verbose', () => {
  test.each([['--verbose'], ['-v']])('%s なら stderr に説明を出し、stdout は 1 行のまま', (flag) => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    const r = spawnSync(tpm, [flag, d], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd()).toBe(run(tpm, [d], scratch));
    expect(r.stderr).toContain(`tpm: config      ${d}/.claude/roles/config.json（あり）\n`);
    expect(r.stderr).toContain('tpm: skill-sets  dependabot（');
    expect(r.stderr).toMatch(/^tpm: core +\S+\/skill-sets\/core → .*\/tpm/m);
    expect(r.stderr).toMatch(/^tpm: dependabot +\S+\/skill-sets\/dependabot → .*\/dependabot-triage/m);
  });

  test('旗が無ければ stderr に何も出さない', () => {
    const r = spawnSync(tpm, [folder(null)], { cwd: scratch, encoding: 'utf8' });
    expect(r.stderr).toBe('');
  });
});

describe('誤りなら 1 行を出さずに止まる', () => {
  test.each([
    ['無い skill セット', '{ "skill-sets": ["nope"] }', /skill セットがありません: nope/],
    ['壊れた JSON', '{ skill-sets: ', /JSON として読めません/],
    ['配列でない skill-sets', '{ "skill-sets": "dependabot" }', /skill-sets は skill セットの名前/],
    ['道を含む skill セットの名前', '{ "skill-sets": ["../x"] }', /skill-sets は skill セットの名前/],
  ])('%s', (_, text, message) => {
    const r = runFailing([folder(text)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(r.stdout).toBe('');
  });

  test('無い folder', () => {
    const r = runFailing([join(scratch, 'nope')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/folder がありません/);
    expect(r.stdout).toBe('');
  });

  test.each([
    ['引数が多すぎる', ['a', 'b']],
    ['知らない旗', ['--print']],
  ])('%sなら使い方の誤りで exit 2', (_, args) => {
    const r = runFailing(args);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
});
