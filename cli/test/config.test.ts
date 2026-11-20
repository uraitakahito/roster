import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { readRolesConfig, rolesConfigFile } from '../src/config.ts';
import { TpmError } from '../src/skill-sets.ts';

let dir: string;
let n = 0;
const config = (text: string): string => {
  const file = join(dir, `config-${n++}.jsonc`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-config-')));
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
    const file = config('{ "software-engineer": { "model": "claude-fable-5-2", "effort": "high" }, "devops-engineer": {} }');
    expect(readRolesConfig(file).roles).toEqual({ 'software-engineer': { model: 'claude-fable-5-2', effort: 'high' }, 'devops-engineer': {} });
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
