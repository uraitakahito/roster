import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { composeRolesConfig, composeSkillSets, describeTrackers, envLabel, readConfigSources, readRolesConfig, rolesConfigFile } from '../src/config.ts';
import { TpmError } from '../src/skill-sets.ts';

let dir: string;
let n = 0;
const config = (text: string): string => {
  const file = join(dir, `config-${n++}.jsonc`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-config-')));
});

describe('readRolesConfig', () => {
  test('ファイルが無ければ既定（課題管理なし・cmux・環境の宣言なし）', () => {
    expect(readRolesConfig(join(dir, 'nope.jsonc'))).toEqual({ tracker: 'none', transport: 'cmux', infra: {}, roles: {} });
  });

  test('コメントと末尾のカンマを書いても読む', () => {
    const file = config('{\n  // 課題は GitHub の Issue に書く\n  "tracker": "github",\n  /* 連携 */ "transport": "file",\n}\n');
    expect(readRolesConfig(file)).toEqual({ tracker: 'github', transport: 'file', infra: {}, roles: {} });
  });

  test('欄が無ければ既定', () => {
    expect(readRolesConfig(config('{ "skill-sets": ["dependabot"] }'))).toEqual({ tracker: 'none', transport: 'cmux', infra: {}, roles: {} });
  });

  test('書いた道具と環境を返す', () => {
    const file = config(JSON.stringify({
      tracker: 'github',
      transport: 'file',
      infra: { 'apple-container': { guard: 'free', match: ['container '] }, 'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] } },
    }));
    expect(readRolesConfig(file)).toEqual({
      tracker: 'github',
      transport: 'file',
      infra: { 'apple-container': { guard: 'free', match: ['container '] }, 'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] } },
      roles: {},
    });
  });

  test('担当ごとの model などは、書いた欄だけを返す', () => {
    const file = config('{ "software-engineer": { "model": "claude-fable-5-2", "effort": "high" }, "devops-engineer": {}, "auditor": { "effort": "medium" } }');
    expect(readRolesConfig(file).roles).toEqual({ 'software-engineer': { model: 'claude-fable-5-2', effort: 'high' }, 'devops-engineer': {}, 'auditor': { effort: 'medium' } });
    expect(readRolesConfig(config('{ "staff-engineer": { "model": "claude-fable-5-2" } }')).roles).toEqual({ 'staff-engineer': { model: 'claude-fable-5-2' } });
  });

  test('前の欄 api（AI-36 の切り替えの間の client の選び）は、どんな値でも読み飛ばす（誤りにしない。設定に残っていても止まらない）', () => {
    for (const text of ['{ "api": { "castlist": "next", "pagetray": "next" } }', '{ "api": "next" }', '{ "api": { "pages": "curl" } }']) {
      expect(readRolesConfig(config(text))).not.toHaveProperty('api');
    }
  });

  test.each([
    ['知らない課題管理', '{ "tracker": "linear" }', /tracker は jira・github・none/],
    ['知らない連携', '{ "transport": "tmux" }', /transport は cmux・file/],
    ['配列の infra', '{ "infra": [] }', /infra は/],
    ['大文字の環境の名前', '{ "infra": { "AWS": { "guard": "pm", "match": ["aws "] } } }', /環境の名前は/],
    ['知らない手続き', '{ "infra": { "x": { "guard": "open", "match": ["x "] } } }', /infra\.x\.guard は free・tpm・pm/],
    ['手続きが無い', '{ "infra": { "x": { "match": ["x "] } } }', /infra\.x\.guard がありません/],
    ['match が無い', '{ "infra": { "x": { "guard": "pm" } } }', /infra\.x\.match は/],
    ['空の match', '{ "infra": { "x": { "guard": "pm", "match": [] } } }', /infra\.x\.match は/],
    ['object でない担当の欄', '{ "software-engineer": "opus" }', /software-engineer は/],
    ['文字列でない model', '{ "devops-engineer": { "model": 5 } }', /devops-engineer\.model は/],
    ['空白だけの match', '{ "infra": { "x": { "guard": "pm", "match": [" "] } } }', /infra\.x\.match は/],
  ])('%sなら TpmError', (_, text, message) => {
    const file = config(text);
    expect(() => readRolesConfig(file)).toThrow(TpmError);
    expect(() => readRolesConfig(file)).toThrow(message);
  });
});

describe('rolesConfigFile', () => {
  const project = (files: string[]): string => {
    const d = join(dir, `p${n++}`);
    mkdirSync(join(d, '.claude', 'roles'), { recursive: true });
    for (const f of files) writeFileSync(join(d, '.claude', 'roles', f), '{}');
    return d;
  };

  test.each([[[]], [['config.jsonc']]])('config.json が無ければ .claude/roles/config.jsonc（置いた物: %j）', (files) => {
    const d = project(files);
    expect(rolesConfigFile(d)).toBe(join(d, '.claude', 'roles', 'config.jsonc'));
  });

  test('config.json だけがあれば、名前を替える mv を言って止める', () => {
    const d = project(['config.json']);
    const dir = join(d, '.claude', 'roles');
    expect(() => rolesConfigFile(d)).toThrow(TpmError);
    expect(() => rolesConfigFile(d)).toThrow(`mv ${dir}/config.json ${dir}/config.jsonc`);
  });

  test('両方あれば、mv を出さずに config.json を消すよう言って止める', () => {
    const d = project(['config.json', 'config.jsonc']);
    expect(() => rolesConfigFile(d)).toThrow(TpmError);
    expect(() => rolesConfigFile(d)).toThrow(/両方あります。config\.json を消してください/);
    expect(() => rolesConfigFile(d)).not.toThrow(/mv /);
  });

  test('mv の path は shell の引用符で囲む（空白のある folder）', () => {
    const d = join(dir, `with space ${n++}`);
    mkdirSync(join(d, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(d, '.claude', 'roles', 'config.json'), '{}');
    expect(() => rolesConfigFile(d)).toThrow(`mv '${d}/.claude/roles/config.json' '${d}/.claude/roles/config.jsonc'`);
  });
});

/** project の folder を作り、folder の名前（'' は project 自身）→ 設定の中身（null なら file を置かない）を書く。 */
const tree = (configs: Record<string, object | null>): string => {
  const project = join(dir, `tree-${n++}`);
  for (const [name, body] of Object.entries(configs)) {
    mkdirSync(join(project, name, '.claude', 'roles'), { recursive: true });
    if (body !== null) writeFileSync(join(project, name, '.claude', 'roles', 'config.jsonc'), JSON.stringify(body));
  }
  return project;
};

describe('readConfigSources', () => {
  test('直下に設定のある folder が無ければ、project の folder の設定だけ', () => {
    const project = tree({ '': { tracker: 'jira' }, 'src': null });
    expect(readConfigSources(project).map(s => [s.name, s.exists, s.written])).toEqual([['', true, ['tracker']]]);
    expect(readConfigSources(tree({ '': null })).map(s => [s.name, s.exists, s.written])).toEqual([['', false, []]]);
  });

  test('直下の folder を名前の順に集める。設定の無い folder・. で始まる folder・node_modules・1 段より深い folder は見ない', () => {
    const project = tree({ '': null, 'web': { tracker: 'github' }, 'api': { tracker: 'jira' }, 'docs': null, '.hidden': { tracker: 'jira' }, 'node_modules': { tracker: 'jira' }, 'api/deep': { tracker: 'github' } });
    writeFileSync(join(project, 'file.txt'), '');
    expect(readConfigSources(project).map(s => [s.name, s.dir, s.exists])).toEqual([['', project, false], ['api', join(project, 'api'), true], ['web', join(project, 'web'), true]]);
  });

  test('folders を書けば、探さずに書いた folder だけを集める（深い folder も書ける。重なりと project 自身は除く）', () => {
    const body = { 'api': { tracker: 'jira' }, 'web': { tracker: 'github' }, 'api/deep': { tracker: 'github' } };
    expect(readConfigSources(tree({ '': { folders: ['web', 'api/deep', 'web', '.'] }, ...body })).map(s => s.name)).toEqual(['', 'web', 'api/deep']);
    expect(readConfigSources(tree({ '': { folders: [] }, ...body })).map(s => s.name)).toEqual(['']);
  });

  test('folders に、設定の無い folder を書いたら誤り', () => {
    const project = tree({ '': { folders: ['docs'] }, 'docs': null });
    expect(() => readConfigSources(project)).toThrow(TpmError);
    expect(() => readConfigSources(project)).toThrow(`folders に書いた docs に、設定がありません: ${project}/docs/.claude/roles/config.jsonc`);
    expect(() => readConfigSources(tree({ '': { folders: 'web' } }))).toThrow(/folders は、集める folder（この folder からの path）の配列/);
  });

  test('直下の folder の古い名前の config.json も、読まずに止める', () => {
    const project = tree({ '': null, 'web': null });
    writeFileSync(join(project, 'web', '.claude', 'roles', 'config.json'), '{}');
    expect(() => readConfigSources(project)).toThrow(/web\/\.claude\/roles\/config\.json は読みません/);
  });

  test('直下の folder の設定の誤りは、その file を名指して止まる', () => {
    const project = tree({ '': null, 'web': { tracker: 'linear' } });
    expect(() => readConfigSources(project)).toThrow(`${project}/web/.claude/roles/config.jsonc の tracker は`);
  });
});

describe('composeRolesConfig', () => {
  test('設定がどこにも無ければ既定（課題管理なし・cmux・環境の宣言なし）', () => {
    const config = composeRolesConfig(tree({ '': null }));
    expect(config).toMatchObject({ transport: 'cmux', trackers: { jira: [], github: [] }, infra: {}, roles: {} });
    expect(describeTrackers(config.sources)).toBe('この folder＝無い');
  });

  test('課題管理は、道具ごとに宣言した設定を覚える（none は足さない）', () => {
    const config = composeRolesConfig(tree({ '': { tracker: 'none' }, 'api': { tracker: 'jira' }, 'skills': { tracker: 'jira' }, 'web': { tracker: 'github' }, 'x': {} }));
    expect(config.trackers.jira.map(s => s.name)).toEqual(['api', 'skills']);
    expect(config.trackers.github.map(s => s.name)).toEqual(['web']);
    expect(describeTrackers(config.sources)).toBe('この folder＝none・api＝jira・skills＝jira・web＝github・x＝none');
  });

  test('infra は環境の名前ごとに合わせる。同じ名前は match を足し、厳しい方の手続きにする', () => {
    const { infra } = composeRolesConfig(tree({
      '': { infra: { store: { guard: 'free', match: ['container stop store'] }, own: { guard: 'pm', match: ['aws '] } } },
      'a': { infra: { store: { guard: 'tpm', match: ['container stop store', '--name store'] } } },
      'b': { infra: { 'store': { guard: 'free', match: ['container rm store'] }, 'b-only': { guard: 'free', match: ['b '] } } },
    }));
    expect(infra).toEqual({
      'store': { guard: 'tpm', match: ['container stop store', '--name store', 'container rm store'], from: ['この folder', 'a', 'b'] },
      'own': { guard: 'pm', match: ['aws '], from: ['この folder'] },
      'b-only': { guard: 'free', match: ['b '], from: ['b'] },
    });
    expect(Object.entries(infra).map(([name, env]) => envLabel(name, env))).toEqual(['store（この folder・a・b の設定）', 'own', 'b-only（b の設定）']);
  });

  test('PM だけ（pm-only）は、いちばん厳しい手続きとして合わせる', () => {
    const { infra } = composeRolesConfig(tree({
      '': { infra: { castlist: { guard: 'pm', match: ['container stop castlist'] } } },
      'castlist': { infra: { castlist: { guard: 'pm-only', match: ['container rm castlist'] } } },
    }));
    expect(infra.castlist?.guard).toBe('pm-only');
  });

  test('連携と担当の既定は、project の folder の設定だけ（直下の folder の値は読まない）', () => {
    const config = composeRolesConfig(tree({
      '': { 'transport': 'file', 'software-engineer': { effort: 'high' } },
      'a': { 'transport': 'cmux', 'software-engineer': { model: 'claude-fable-5-2' }, 'folders': ['nope'] },
    }));
    expect(config.transport).toBe('file');
    expect(config.roles).toEqual({ 'software-engineer': { effort: 'high' } });
    expect(composeRolesConfig(tree({ '': null, 'a': { transport: 'file' } })).transport).toBe('cmux');
  });
});

describe('composeSkillSets', () => {
  test('集めた設定の skill-sets を、集めた順に足す（重なりは除く）', () => {
    const root = join(dir, 'root');
    for (const name of ['dependabot', 'extra']) mkdirSync(join(root, 'skill-sets', name, '.claude', 'skills'), { recursive: true });
    const project = tree({ '': { 'skill-sets': ['extra'] }, 'a': { 'skill-sets': ['dependabot', 'extra'] }, 'b': {} });
    expect(composeSkillSets(readConfigSources(project), root)).toEqual(['extra', 'dependabot']);
  });
});
