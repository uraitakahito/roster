import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { TpmError } from '../src/skill-sets.ts';
import { migrateLegacyJson, State, stateDir } from '../src/state.ts';

let state: State;

beforeEach(() => {
  state = new State(realpathSync(mkdtempSync(join(tmpdir(), 'tpm-state-'))));
});

describe('stateDir', () => {
  test('XDG_STATE_HOME の下に、project の path から作った名の folder', () => {
    expect(stateDir('/Users/me/my work/app', { XDG_STATE_HOME: '/s' })).toBe('/s/tpm/-Users-me-my-work-app');
  });

  test('TPM_STATE があればそれを使う', () => {
    expect(stateDir('/w', { TPM_STATE: '/given', XDG_STATE_HOME: '/s' })).toBe('/given');
  });

  test('XDG_STATE_HOME が無ければ ~/.local/state', () => {
    expect(stateDir('/w', {})).toMatch(/\/\.local\/state\/tpm\/-w$/);
  });
});

describe('State', () => {
  test('書いた物を読める。無ければ undefined', () => {
    expect(state.read('roles/t-x7k2.jsonc')).toBeUndefined();
    state.write('roles/t-x7k2.jsonc', { key: 't-x7k2' });
    expect(state.read('roles/t-x7k2.jsonc')).toEqual({ key: 't-x7k2' });
  });

  test('コメントと末尾のカンマのある JSONC を読める', () => {
    writeFileSync(join(state.dir, 'tpm.jsonc'), '{\n  // TPM 担当\n  "address": "a", /* 宛先 */\n}\n');
    expect(state.read('tpm.jsonc')).toEqual({ address: 'a' });
  });

  test('読めない中身は、ファイルの名を添えて TpmError', () => {
    writeFileSync(join(state.dir, 'tpm.jsonc'), '{ "address": ');
    expect(() => state.read('tpm.jsonc')).toThrow(TpmError);
    expect(() => state.read('tpm.jsonc')).toThrow(`${state.dir}/tpm.jsonc を JSONC として読めません: `);
  });

  test('書きかけのファイルを残さない', () => {
    state.write('tpm.jsonc', { address: 'a' });
    expect(readdirSync(state.dir)).toEqual(['tpm.jsonc']);
  });

  test('folder の中の .jsonc を名前順に並べ、消した物と .json は出ない', () => {
    expect(state.list('roles')).toEqual([]);
    state.write('roles/t-b5c6.jsonc', {});
    state.write('roles/t-a3b4.jsonc', {});
    writeFileSync(join(state.dir, 'roles', 't-c.json'), '{}');
    state.remove('roles/t-b5c6.jsonc');
    state.remove('roles/nope.jsonc');
    expect(state.list('roles')).toEqual(['t-a3b4']);
  });

  test('1 行 1 件の記録を足した順に読める', () => {
    expect(state.lines('log.jsonl')).toEqual([]);
    state.append('log.jsonl', { n: 1 });
    state.append('log.jsonl', { n: 2 });
    expect(state.lines('log.jsonl')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('migrateLegacyJson', () => {
  const put = (name: string, text: string, mtime?: number): void => {
    const file = join(state.dir, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    if (mtime !== undefined) utimesSync(file, mtime, mtime);
  };
  const files = (): string[] => (readdirSync(state.dir, { recursive: true }) as string[]).filter(f => f.includes('.')).sort();

  test('下の folder まで *.json を *.jsonc に替え、中身はそのまま', () => {
    put('tpm.json', '{ "address": "a" }');
    put('roles/t-x7k2.json', '{ "key": "t-x7k2" }');
    put('file-transport/seats/file-1.json', '{}');
    migrateLegacyJson(state.dir);
    expect(files()).toEqual(['file-transport/seats/file-1.jsonc', 'roles/t-x7k2.jsonc', 'tpm.jsonc']);
    expect(state.read('roles/t-x7k2.jsonc')).toEqual({ key: 't-x7k2' });
  });

  test('.jsonl・書きかけ・.jsonc には触らない', () => {
    put('log.jsonl', '{}\n');
    put('roles/t-x7k2.json.123.tmp', '{');
    put('roles/t-y.jsonc', '{}');
    migrateLegacyJson(state.dir);
    expect(files()).toEqual(['log.jsonl', 'roles/t-x7k2.json.123.tmp', 'roles/t-y.jsonc']);
  });

  test.each([
    ['.jsonc が新しい', 2000, 1000, 'new'],
    ['.json が新しい', 1000, 2000, 'old'],
  ])('両方あれば新しい方を .jsonc に残す（%s）', (_, jsoncAt, jsonAt, kept) => {
    put('roles/t-x7k2.jsonc', '{ "v": "new" }', jsoncAt);
    put('roles/t-x7k2.json', '{ "v": "old" }', jsonAt);
    migrateLegacyJson(state.dir);
    expect(files()).toEqual(['roles/t-x7k2.jsonc']);
    expect(JSON.parse(readFileSync(join(state.dir, 'roles/t-x7k2.jsonc'), 'utf8'))).toEqual({ v: kept });
  });

  test('移し済み・folder が無いときは何もしない', () => {
    expect(() => migrateLegacyJson(join(state.dir, 'nope'))).not.toThrow();
    put('tpm.jsonc', '{}');
    migrateLegacyJson(state.dir);
    expect(files()).toEqual(['tpm.jsonc']);
  });
});
