// cli/src/cli.ts を cli/bin/roster（sh）経由で動かす。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { missingCastlistWarning } from '../src/castlist.ts';
import { composeRolesConfig } from '../src/config.ts';
import { buildProgram, commandPaths, runProgram } from '../src/program.ts';
import { REPLY_LANGUAGE } from '../src/command.ts';
import { shellQuote } from '../src/shell.ts';
import { COMMANDS } from '../src/protocol.ts';
import { TpmError } from '../src/skill-sets.ts';
import { withoutRosterEnv } from '../src/env.ts';

/** cli/ の folder（bin/roster と src/ がある）と、その 1 つ上の repo。 */
const cli = realpathSync(join(import.meta.dirname, '..'));
const root = join(cli, '..');
const entry = join(cli, 'bin', 'roster');
/** 席に付く、メッセージを渡す hook の字（待つ命令と、Bash の後に渡す命令）。 */
const waiting = `{"type":"command","async":true,"asyncRewake":true,"timeout":86400,"command":"${root}/cli/bin/roster mail wait"}`;
const gate = `[{"matcher":"Bash","hooks":[{"type":"command","command":"${root}/cli/bin/roster mail gate"}]}]`;
const head = `PATH=${root}/cli/bin:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"${root}/cli/bin/roster guard"}]}],"SessionStart":[{"hooks":[{"type":"command","command":"${root}/cli/bin/roster castlist session-start"},{"type":"command","command":"${root}/cli/bin/roster mail claim"},${waiting}]}],"SessionEnd":[{"hooks":[{"type":"command","command":"${root}/cli/bin/roster castlist session-end"},{"type":"command","command":"${root}/cli/bin/roster mail release"}]}],"PostToolUse":${gate},"PostToolUseFailure":${gate},"Stop":[{"hooks":[${waiting},{"type":"command","command":"${root}/cli/bin/roster reply-language check"}]}],"UserPromptSubmit":[{"hooks":[{"type":"command","command":"${root}/cli/bin/roster mail prompt"}]}]}}' --append-system-prompt ${shellQuote(REPLY_LANGUAGE)}`;
let scratch: string;
const mkdirp = (dir: string): string => {
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** 試験を流す人の profile の ROSTER_MODEL など（roster の環境変数を新旧の名とも）を抜いた環境変数に、extra を足す。 */
const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  // 状態と控えの folder は一時の folder にする（試験を流す機械の本物の folder を読まない）。
  // 試験を流す担当の居場所の roster の環境変数（新旧の名とも）は渡さない（$ROSTER_STATE は XDG_STATE_HOME より先に効く）。
  return { ...withoutRosterEnv(process.env), XDG_STATE_HOME: join(scratch, 'xdg-state'), XDG_DATA_HOME: join(scratch, 'xdg-data'), ...extra };
};
const run = (bin: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}): string =>
  execFileSync(bin, args, { cwd, encoding: 'utf8', env: env(extra) }).trimEnd();
const runFailing = (args: string[]) => spawnSync(entry, ['start', ...args], { cwd: scratch, encoding: 'utf8', env: env() });

// .claude/roles/config.jsonc に text を書いた folder を作る（text が null なら config.jsonc を置かない）
let n = 0;
/** castlist を設定していない folder で roster start が stderr に出す警告（1 行ずつ「roster: 」を頭に付ける）。 */
const castlistWarning = (dir: string): string => missingCastlistWarning({ env: {}, config: composeRolesConfig(dir) }).map(l => `roster: ${l}\n`).join('');

const folder = (text: string | null): string => {
  const d = join(scratch, `f${n++}`);
  mkdirSync(join(d, '.claude', 'roles'), { recursive: true });
  if (text !== null) writeFileSync(join(d, '.claude', 'roles', 'config.jsonc'), text);
  return d;
};

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'roster-test-')));
});

describe('roster start が出す 1 行', () => {
  test('folder を渡さなければ今いる folder に cd する', () => {
    expect(run(entry, ['start'], scratch)).toMatch(new RegExp(`^cd ${scratch} && `));
  });

  test('渡した folder に cd する', () => {
    const d = folder(null);
    expect(run(entry, ['start', d], root)).toMatch(new RegExp(`^cd ${d} && `));
  });

  test('config.jsonc が無ければ core だけを --add-dir で足し、/tpm の前に -- を置く', () => {
    const d = folder(null);
    expect(run(entry, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('$ROSTER_MODEL・$ROSTER_EFFORT・$ROSTER_PERMISSION_MODE があれば、その値で起こす', () => {
    const d = folder(null);
    expect(run(entry, ['start', d], scratch, { ROSTER_MODEL: 'claude-fable-5-2', ROSTER_EFFORT: 'high', ROSTER_PERMISSION_MODE: 'acceptEdits' }))
      .toMatch(/ claude --model claude-fable-5-2 --effort high --permission-mode acceptEdits --settings /);
  });

  test('1 回だけ付けた ROSTER_MODEL などは、1 行を打つと TPM 担当の claude の環境に入る', () => {
    const d = folder(null);
    const fake = join(scratch, `fake-claude-${n++}`);
    mkdirSync(fake);
    writeFileSync(join(fake, 'claude'), '#!/bin/sh\nprintf "%s|%s|%s|%s %s" "$ROSTER_MODEL" "$ROSTER_EFFORT" "$ROSTER_PERMISSION_MODE" "$1" "$2"\n', { mode: 0o755 });
    const line = run(entry, ['start', d], scratch, { ROSTER_MODEL: 'claude-fable-5-2', ROSTER_EFFORT: 'high' });
    // 1 行を打つ shell には TPM_* が無い（roster start の前に 1 回だけ付けたとき）
    const out = execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8', env: env({ PATH: `${fake}:${process.env.PATH ?? ''}` }) });
    expect(out).toBe('claude-fable-5-2|high||--model claude-fable-5-2');
  });

  test('config.jsonc の担当の欄は TPM 担当の 1 行に効かない', () => {
    const d = folder('{ "software-engineer": { "model": "claude-fable-5-2" } }');
    expect(run(entry, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets の欄が無ければ core だけ', () => {
    const d = folder('{ "software-engineer": { "effort": "high" } }');
    expect(run(entry, ['start', d], scratch)).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core -- /tpm`);
  });

  test('skill-sets に書いた追加の skill セットも足す', () => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    expect(run(entry, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('コメントと末尾のカンマを書いた config.jsonc も読む', () => {
    const d = folder('{\n  // Dependabot の skill も使う\n  "skill-sets": ["dependabot",],\n}\n');
    expect(run(entry, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('skill-sets の core と重なりは 1 度だけ足す', () => {
    const d = folder('{ "skill-sets": ["core", "dependabot", "dependabot"] }');
    expect(run(entry, ['start', d], scratch)).toBe(
      `cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`,
    );
  });

  test('symlink から呼んでも repo を正しく求める', () => {
    const link = join(scratch, 'roster-link');
    symlinkSync(entry, link);
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
    const r = spawnSync(entry, ['start', '-v', d], { cwd: scratch, encoding: 'utf8', env: env() });
    expect(r.stdout.trimEnd()).toBe(`cd ${d} && ${head} --add-dir ${root}/skill-sets/core ${root}/skill-sets/dependabot -- /tpm`);
    expect(r.stderr.split('\n').filter(l => l.startsWith('roster: config'))).toEqual([
      `roster: config      ${d}/.claude/roles/config.jsonc（なし）`,
      `roster: config      ${d}/a/.claude/roles/config.jsonc（あり）`,
      `roster: config      ${d}/b/.claude/roles/config.jsonc（あり）`,
    ]);
  });

  test('folders を書けば、書いた folder だけを集める', () => {
    expect(run(entry, ['start', parent('{ "folders": ["a"] }')], scratch)).toMatch(/--add-dir \S+\/skill-sets\/core -- \/tpm$/);
    expect(run(entry, ['start', parent('{ "folders": [] }')], scratch)).toMatch(/--add-dir \S+\/skill-sets\/core -- \/tpm$/);
  });
});

describe('--verbose', () => {
  test.each([['--verbose'], ['-v']])('%s なら stderr に説明を出し、stdout は 1 行のまま', (flag) => {
    const d = folder('{ "skill-sets": ["dependabot"] }');
    const r = spawnSync(entry, ['start', flag, d], { cwd: scratch, encoding: 'utf8', env: env() });
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd()).toBe(run(entry, ['start', d], scratch));
    expect(r.stderr).toContain(`roster: config      ${d}/.claude/roles/config.jsonc（あり）\n`);
    expect(r.stderr).toContain('roster: skill-sets  dependabot（');
    expect(r.stderr).toMatch(/^roster: core +\S+\/skill-sets\/core → .*\/tpm/m);
    expect(r.stderr).toMatch(/^roster: dependabot +\S+\/skill-sets\/dependabot → .*\/dependabot-triage/m);
  });

  test('担当の居場所で打っても、受け継いだ状態の folder を使わない', () => {
    // 受け継いだ path が無い folder を指していると、使えば止まる（stateDir の守り）。
    const dir = folder(null);
    const r = spawnSync(entry, ['start', dir], { cwd: scratch, encoding: 'utf8', env: env({ ROSTER_STATE: join(scratch, 'gone') }) });
    expect(r.stderr).toBe(castlistWarning(dir));
    expect(r.status).toBe(0);
  });

  test('旗が無ければ stderr には castlist の警告だけを出す（terminal でないので色の符号は無い）', () => {
    const dir = folder(null);
    const r = spawnSync(entry, ['start', dir], { cwd: scratch, encoding: 'utf8', env: env() });
    expect(r.stderr).toBe(castlistWarning(dir));
    expect(r.stderr).toContain('⚠ 警告: castlist（アクターの台帳）を設定していません');
    expect(r.stderr).not.toContain('\u001b[');
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
    // 試験を流す担当の ROSTER_KEY などを受け継がない
    const out = run(entry, ['roles'], d, { ROSTER_PROJECT: d, ROSTER_STATE: state, ROSTER_KEY: '', ROSTER_ADDRESS: '' });
    expect(out).toMatch(/^名簿:\n- t-x7k2 {2}題 {2}消えた/);
    expect(readdirSync(state).sort()).toEqual(['roles', 'tpm.jsonc']);
    expect(readdirSync(join(state, 'roles'))).toEqual(['t-x7k2.jsonc']);
  });
});

describe('命令の一覧', () => {
  test('命令を渡さなければ、使い方を出して exit 2', () => {
    const r = spawnSync(entry, [], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Usage: roster');
  });

  test('命令の木は protocol.ts の COMMANDS と揃っている', () => {
    expect(commandPaths(buildProgram()).sort()).toEqual([...COMMANDS].sort());
  });

  test('決まりの誤りは roster: で始まる 1 行を出して exit 1', () => {
    // scratch の直下には、ほかの試験がわざと誤りを書いた設定がある（集めて読むと止まる）ので、空の folder で打つ。受け継いだ $ROSTER_PROJECT も消す。
    const r = spawnSync(entry, ['ask', 'tpm', 'x', '--waiting-for', 'y'], { cwd: folder(null), encoding: 'utf8', env: { ...withoutRosterEnv(process.env), ROSTER_STATE: mkdirp(join(scratch, 'state')) } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^roster: \$ROSTER_KEY がありません/);
  });

  test('roster init は無い（TPM 担当も roster hello で名乗る）', () => {
    const r = spawnSync(entry, ['init'], { cwd: scratch, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown command \'init\'');
  });
});

describe('命令の入口（runProgram）は、非同期の誤りも同期の誤りと同じに扱う', () => {
  /** program を動かし、stderr に書いた字と、process.exit に渡した終了コード（呼ばなければ undefined）を返す。process.env は env に替え、後で戻す。 */
  const runIn = async (program: Command, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ stderr: string, status: number | undefined }> => {
    let stderr = '';
    let status: number | undefined;
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      status ??= Number(code ?? 0);
      return undefined as never;
    });
    const saved = process.env;
    // 試験を流す担当の居場所の roster の環境変数と cmux の変数は渡さない（本物の project と状態の folder を読まない）。
    process.env = { ...Object.fromEntries(Object.entries(withoutRosterEnv(saved)).filter(([name]) => !name.startsWith('CMUX_'))), ...env };
    try {
      await runProgram(['node', 'roster', ...args], program);
    }
    finally {
      process.env = saved;
      write.mockRestore();
      exit.mockRestore();
    }
    return { stderr, status };
  };

  test.each([
    ['同期', () => {
      throw new TpmError('決まりの誤り');
    }],
    ['非同期', async () => {
      await Promise.resolve();
      throw new TpmError('決まりの誤り');
    }],
  ])('命令が%sに TpmError を投げれば、roster: で始まる 1 行を出して exit 1', async (_, action) => {
    const program = new Command().name('roster');
    program.command('boom').action(action);
    expect(await runIn(program, ['boom'])).toEqual({ stderr: 'roster: 決まりの誤り\n', status: 1 });
  });

  test('guard の決めが非同期に誤っても、roster guard: で止めて exit 2', async () => {
    const d = folder(null);
    const stdin = JSON.stringify({ session_id: 's-async', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: d });
    // castlist の URL の形の誤りは、castlist の分（Bash を通すと決めた後）で投げる。
    const r = await runIn(buildProgram(() => stdin), ['guard'], { ROSTER_PROJECT: d, ROSTER_STATE: mkdirp(join(d, 'state')), ROSTER_CASTLIST_URL: 'http://example.com:1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('roster guard: guard が命令を見られません: $ROSTER_CASTLIST_URL は http://127.0.0.1:<port> か http://localhost:<port> の形にしてください: http://example.com:1\n');
  });

  test.each(['session-start', 'session-end'])('castlist %s の hook は、非同期に誤っても stderr に 1 行を書いて 0 で終わる', async (hook) => {
    const d = folder(null);
    const stdin = JSON.stringify({ session_id: 's-async', source: 'startup', cwd: d });
    const r = await runIn(buildProgram(() => stdin), ['castlist', hook], { ROSTER_PROJECT: d, ROSTER_STATE: mkdirp(join(d, 'state')), ROSTER_CASTLIST_URL: 'http://example.com:1' });
    // hook の失敗を Claude Code の画面に出さないため、どんな誤りでも 0（process.exit を呼ばない）。
    expect(r.status).toBeUndefined();
    expect(r.stderr).toMatch(new RegExp(`^roster castlist ${hook}: [^\\n]+\\n$`));
  });
});
