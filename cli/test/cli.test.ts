// cli/src/cli.ts を cli/bin/tpm（sh）経由で動かす。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildProgram, commandPaths } from '../src/program.ts';
import { COMMANDS } from '../src/protocol.ts';
import { SETTINGS_ENV } from '../src/settings.ts';

/** cli/ の folder（bin/tpm と src/ がある）と、その 1 つ上の repo。 */
const cli = realpathSync(join(import.meta.dirname, '..'));
const root = join(cli, '..');
const tpm = join(cli, 'bin', 'tpm');
const head = `PATH=${root}/cli/bin:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"${root}/cli/bin/tpm guard"}]}]}}'`;
let scratch: string;

/** 試験を流す人の profile の TPM_MODEL などを抜いた環境変数に、extra を足す。 */
const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const e = { ...process.env, ...extra };
  for (const name of Object.values(SETTINGS_ENV)) if (!(name in extra)) delete e[name];
  return e;
};
const run = (bin: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}): string =>
  execFileSync(bin, args, { cwd, encoding: 'utf8', env: env(extra) }).trimEnd();
const runFailing = (args: string[]) => spawnSync(tpm, ['start', ...args], { cwd: scratch, encoding: 'utf8', env: env() });

// .claude/roles/config.jsonc に text を書いた folder を作る（text が null なら config.jsonc を置かない）
let n = 0;
const folder = (text: string | null): string => {
  const d = join(scratch, `f${n++}`);
  mkdirSync(join(d, '.claude', 'roles'), { recursive: true });
  if (text !== null) writeFileSync(join(d, '.claude', 'roles', 'config.jsonc'), text);
  return d;
};

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-test-')));
});

describe('tpm start が出す 1 行', () => {
  test('folder を渡さなければ今いる folder に cd する', () => {
    expect(run(tpm, ['start'], scratch)).toMatch(new RegExp(`^cd ${scratch} && `));
  });

  test('渡した folder に cd する', () => {
    const d = folder(null);
    expect(run(tpm, ['start', d], root)).toMatch(new RegExp(`^cd ${d} && `));
  });

  test('config.jsonc が無ければ core だけを --add-dir で足し、/tpm の前に -- を置く', () => {
    const d = folder(null);
    expect(run(tpm, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('$TPM_MODEL・$TPM_EFFORT・$TPM_PERMISSION_MODE があれば、その値で起こす', () => {
    const d = folder(null);
    expect(run(tpm, ['start', d], scratch, { TPM_MODEL: 'claude-fable-5-2', TPM_EFFORT: 'high', TPM_PERMISSION_MODE: 'acceptEdits' }))
      .toMatch(/ claude --model claude-fable-5-2 --effort high --permission-mode acceptEdits --settings /);
  });

  test('config.jsonc の担当の欄は TPM 担当の 1 行に効かない', () => {
    const d = folder('{ "software-engineer": { "model": "claude-fable-5-2" } }');
    expect(run(tpm, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets の欄が無ければ core だけ', () => {
    const d = folder('{ "software-engineer": { "effort": "high" } }');
    expect(run(tpm, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets に書いた追加の skill セットも足す', () => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    expect(run(tpm, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('コメントと末尾のカンマを書いた config.jsonc も読む', () => {
    const d = folder('{\n  // Dependabot の skill も使う\n  "skill-sets": ["dependabot",],\n}\n');
    expect(run(tpm, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('skill-sets の core と重なりは 1 度だけ足す', () => {
    const d = folder('{ "skill-sets": ["core", "dependabot", "dependabot"] }');
    expect(run(tpm, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('symlink から呼んでも repo を正しく求める', () => {
    const link = join(scratch, 'tpm-link');
    symlinkSync(tpm, link);
    expect(run(link, ['start'], scratch)).toMatch(new RegExp(`--add-dir ${root}/skill-sets/core -- /tpm$`));
  });
});

describe('--verbose', () => {
  test.each([['--verbose'], ['-v']])('%s なら stderr に説明を出し、stdout は 1 行のまま', (flag) => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    const r = spawnSync(tpm, ['start', flag, d], { cwd: scratch, encoding: 'utf8', env: env() });
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd()).toBe(run(tpm, ['start', d], scratch));
    expect(r.stderr).toContain(`tpm: config      ${d}/.claude/roles/config.jsonc（あり）\n`);
    expect(r.stderr).toContain('tpm: skill-sets  dependabot（');
    expect(r.stderr).toMatch(/^tpm: core +\S+\/skill-sets\/core → .*\/tpm/m);
    expect(r.stderr).toMatch(/^tpm: dependabot +\S+\/skill-sets\/dependabot → .*\/dependabot-triage/m);
  });

  test('旗が無ければ stderr に何も出さない', () => {
    const r = spawnSync(tpm, ['start', folder(null)], { cwd: scratch, encoding: 'utf8' });
    expect(r.stderr).toBe('');
  });
});

describe('誤りなら 1 行を出さずに止まる', () => {
  test.each([
    ['無い skill セット', '{ "skill-sets": ["nope"] }', /skill セットがありません: nope/],
    ['壊れた JSON', '{ skill-sets: ', /JSONC として読めません/],
    ['配列でない skill-sets', '{ "skill-sets": "dependabot" }', /skill-sets は skill セットの名前/],
    ['道を含む skill セットの名前', '{ "skill-sets": ["../x"] }', /skill-sets は skill セットの名前/],
  ])('%s', (_, text, message) => {
    const r = runFailing([folder(text)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(r.stdout).toBe('');
  });

  test('古い config.json があれば、名前を替えるよう言って止まる', () => {
    const d = folder(null);
    writeFileSync(join(d, '.claude', 'roles', 'config.json'), '{ "skill-sets": ["dependabot"] }');
    const r = runFailing([d]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${d}/.claude/roles/config.json は読みません。config.jsonc に名前を替えてください`);
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

describe('命令の一覧', () => {
  test('命令を渡さなければ、使い方を出して exit 2', () => {
    const r = spawnSync(tpm, [], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Usage: tpm');
  });

  test('命令の木は protocol.ts の COMMANDS と揃っている', () => {
    expect(commandPaths(buildProgram()).sort()).toEqual([...COMMANDS].sort());
  });

  test('決まりの誤りは tpm: で始まる 1 行を出して exit 1', () => {
    const r = spawnSync(tpm, ['ask', 'tpm', 'x', '--waiting-for', 'y'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, TPM_KEY: '', TPM_STATE: join(scratch, 'state') } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^tpm: \$TPM_KEY がありません/);
  });

  test('tpm init は無い（TPM 担当も tpm hello で名乗る）', () => {
    const r = spawnSync(tpm, ['init'], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown command \'init\'');
  });
});
