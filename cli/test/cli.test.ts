// cli/src/cli.ts を cli/bin/tpm（sh）経由で動かす。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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
const head = `PATH=${root}/cli/bin:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"${root}/cli/bin/tpm guard"}]}],"SessionStart":[{"hooks":[{"type":"command","command":"${root}/cli/bin/tpm castlist session-start"},{"type":"command","command":"${root}/cli/bin/tpm returned check"}]}],"SessionEnd":[{"hooks":[{"type":"command","command":"${root}/cli/bin/tpm castlist session-end"}]}]}}'`;
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

  test('1 回だけ付けた TPM_MODEL などは、1 行を打つと TPM 担当の claude の環境に入る', () => {
    const d = folder(null);
    const fake = join(scratch, `fake-claude-${n++}`);
    mkdirSync(fake);
    writeFileSync(join(fake, 'claude'), '#!/bin/sh\nprintf "%s|%s|%s|%s %s" "$TPM_MODEL" "$TPM_EFFORT" "$TPM_PERMISSION_MODE" "$1" "$2"\n', { mode: 0o755 });
    const line = run(tpm, ['start', d], scratch, { TPM_MODEL: 'claude-fable-5-2', TPM_EFFORT: 'high' });
    // 1 行を打つ shell には TPM_* が無い（tpm start の前に 1 回だけ付けたとき）
    const out = execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8', env: env({ PATH: `${fake}:${process.env.PATH ?? ''}` }) });
    expect(out).toBe('claude-fable-5-2|high||--model claude-fable-5-2');
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
    // scratch の直下には、ほかの試験が設定を置いた folder がある（その skill-sets も足される）ので、空の folder で打つ。
    expect(run(link, ['start'], folder(null))).toMatch(new RegExp(`--add-dir ${root}/skill-sets/core -- /tpm$`));
  });
});

describe('直下の folder の設定', () => {
  /** 直下に、設定のある folder（a・b）と、設定の無い folder（c）・見ない folder（.hidden・node_modules）を持つ folder。 */
  const parent = (own: string | null): string => {
    const d = folder(own);
    const put = (name: string, text: string | null): void => {
      mkdirSync(join(d, name, '.claude', 'roles'), { recursive: true });
      if (text !== null) writeFileSync(join(d, name, '.claude', 'roles', 'config.jsonc'), text);
    };
    put('b', '{ "skill-sets": ["dependabot"] }');
    put('a', '{ "tracker": "jira" }');
    put('c', null);
    put('.hidden', '{ "skill-sets": ["nope"] }');
    put('node_modules', '{ "skill-sets": ["nope"] }');
    return d;
  };

  test('直下の folder の skill-sets も足し、-v は読んだ設定を並べる', () => {
    const d = parent(null);
    const r = spawnSync(tpm, ['start', '-v', d], { cwd: scratch, encoding: 'utf8', env: env() });
    expect(r.stdout.trimEnd()).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`);
    expect(r.stderr.split('\n').filter(l => l.startsWith('tpm: config'))).toEqual([
      `tpm: config      ${d}/.claude/roles/config.jsonc（なし）`,
      `tpm: config      ${d}/a/.claude/roles/config.jsonc（あり）`,
      `tpm: config      ${d}/b/.claude/roles/config.jsonc（あり）`,
    ]);
  });

  test('folders を書けば、書いた folder だけを集める', () => {
    expect(run(tpm, ['start', parent('{ "folders": ["a"] }')], scratch)).toMatch(/--add-dir \S+\/skill-sets\/core -- \/tpm$/);
    expect(run(tpm, ['start', parent('{ "folders": [] }')], scratch)).toMatch(/--add-dir \S+\/skill-sets\/core -- \/tpm$/);
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

describe('古い名の状態', () => {
  test('tpm.json・roles/*.json を置いた状態の folder でも、最初の命令が .jsonc に移して名簿を出す', () => {
    const d = folder('{ "transport": "file" }');
    const state = join(scratch, `state${n++}`);
    mkdirSync(join(state, 'roles'), { recursive: true });
    writeFileSync(join(state, 'tpm.json'), '{ "address": "file:tpm" }');
    writeFileSync(join(state, 'roles', 't-x7k2.json'), JSON.stringify({ key: 't-x7k2', role: 'software-engineer', title: '題', cwd: d, addDirs: [] }));
    // 試験を流す担当の TPM_KEY などを受け継がない
    const out = run(tpm, ['roles'], d, { TPM_PROJECT: d, TPM_STATE: state, TPM_KEY: '', TPM_ADDRESS: '' });
    expect(out).toMatch(/^名簿:\n- t-x7k2 {2}題 {2}消えた/);
    expect(readdirSync(state).sort()).toEqual(['roles', 'tpm.jsonc']);
    expect(readdirSync(join(state, 'roles'))).toEqual(['t-x7k2.jsonc']);
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
    // scratch の直下には、ほかの試験がわざと誤りを書いた設定がある（集めて読むと止まる）ので、空の folder で打つ。受け継いだ $TPM_PROJECT も消す。
    const r = spawnSync(tpm, ['ask', 'tpm', 'x', '--waiting-for', 'y'], { cwd: folder(null), encoding: 'utf8', env: { ...process.env, TPM_PROJECT: '', TPM_KEY: '', TPM_STATE: join(scratch, 'state') } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^tpm: \$TPM_KEY がありません/);
  });

  test('tpm init は無い（TPM 担当も tpm hello で名乗る）', () => {
    const r = spawnSync(tpm, ['init'], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown command \'init\'');
  });
});
