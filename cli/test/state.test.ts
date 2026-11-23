import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TpmError } from '../src/skill-sets.ts';
import { migrateLegacyJson, rosterHome, State, stateDir } from '../src/state.ts';

let state: State;

beforeEach(() => {
  state = new State(realpathSync(mkdtempSync(join(tmpdir(), 'roster-state-'))));
});

describe('stateDir', () => {
  test('XDG_STATE_HOME の下に、project の path から作った名の folder', () => {
    expect(stateDir('/Users/me/my work/app', { XDG_STATE_HOME: '/s' })).toBe('/s/roster/-Users-me-my-work-app');
  });

  test('ROSTER_STATE（無ければ古い名 TPM_STATE）があればそれを使う', () => {
    expect(stateDir('/w', { ROSTER_STATE: state.dir, XDG_STATE_HOME: '/s' })).toBe(state.dir);
    expect(stateDir('/w', { TPM_STATE: state.dir, XDG_STATE_HOME: '/s' })).toBe(state.dir);
  });

  test('渡された folder が無ければ、作らずに止める（古い在り処の path のまま復元された居場所）', () => {
    const gone = join(state.dir, 'gone');
    expect(() => stateDir('/w', { ROSTER_STATE: gone })).toThrow(/状態の folder .*gone がありません.*先に作った folder.*居場所を閉じ/);
    expect(existsSync(gone)).toBe(false);
  });

  test('XDG_STATE_HOME が無ければ ~/.local/state', () => {
    vi.stubEnv('HOME', state.dir);
    try {
      expect(stateDir('/w', {})).toBe(join(state.dir, '.local', 'state', 'roster', '-w'));
    }
    finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('rosterHome（古い在り処 state/tpm）', () => {
  const marked = (dir: string): boolean => existsSync(join(dir, 'mark'));
  /** parent の下に roster の印のある本物の folder を作る。 */
  const real = (name: string): string => {
    mkdirSync(join(state.dir, name, 'mark'), { recursive: true });
    return join(state.dir, name);
  };

  test('古い名が無ければ、新しい名の folder', () => {
    expect(rosterHome(state.dir, marked)).toBe(join(state.dir, 'roster'));
  });

  test('古い名が新しい名への symlink（移した後の形）なら、新しい名の folder', () => {
    real('roster');
    symlinkSync('roster', join(state.dir, 'tpm'));
    expect(rosterHome(state.dir, marked)).toBe(join(state.dir, 'roster'));
  });

  test('新しい名が古い名への symlink（逆向き）でも、同じ folder なので新しい名を使い、割れているとは言わない', () => {
    real('tpm');
    symlinkSync('tpm', join(state.dir, 'roster'));
    expect(rosterHome(state.dir, marked)).toBe(join(state.dir, 'roster'));
  });

  test('古い名が印の無い folder（別の道具の物）なら、触らずに新しい名を使う', () => {
    mkdirSync(join(state.dir, 'tpm'));
    expect(rosterHome(state.dir, marked)).toBe(join(state.dir, 'roster'));
  });

  test('古い名が本物の folder で新しい名が無ければ、空の状態を作らずに止め、移す 1 行を出す', () => {
    real('tpm');
    expect(() => rosterHome(state.dir, marked)).toThrow(`移してください: mv ${join(state.dir, 'tpm')} ${join(state.dir, 'roster')} && ln -s roster ${join(state.dir, 'tpm')}`);
    expect(existsSync(join(state.dir, 'roster'))).toBe(false);
  });

  test('古い名が別の所への symlink で新しい名が無ければ、止めて、新しい名をその所への link にする 1 行を出す', () => {
    const elsewhere = real('elsewhere');
    symlinkSync(elsewhere, join(state.dir, 'tpm'));
    expect(() => rosterHome(state.dir, marked)).toThrow(`移してください: ln -s ${elsewhere} ${join(state.dir, 'roster')}`);
  });

  test('古い名と新しい名が別の folder なら、割れていると止める', () => {
    real('tpm');
    real('roster');
    expect(() => rosterHome(state.dir, marked)).toThrow(/別の folder です（割れている）/);
  });

  test('stateBase の印は project の状態の folder（tpm.jsonc か roles/）', () => {
    mkdirSync(join(state.dir, 'tpm', 'other-tool'), { recursive: true });
    expect(stateDir('/w', { XDG_STATE_HOME: state.dir })).toBe(join(state.dir, 'roster', '-w'));
    mkdirSync(join(state.dir, 'tpm', '-p', 'roles'), { recursive: true });
    expect(() => stateDir('/w', { XDG_STATE_HOME: state.dir })).toThrow(/古い在り処です/);
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
