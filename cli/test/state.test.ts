import { mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { State, stateDir } from '../src/state.ts';

let state: State;

beforeEach(() => {
  state = new State(realpathSync(mkdtempSync(join(tmpdir(), 'tpm-state-'))));
});

describe('stateDir', () => {
  test('XDG_STATE_HOME の下に、project の path から作った名の folder', () => {
    expect(stateDir('/Users/me/my work/app', { XDG_STATE_HOME: '/s' })).toBe('/s/tpm/-Users-me-my-work-app');
  });

  test('XDG_STATE_HOME が無ければ ~/.local/state', () => {
    expect(stateDir('/w', {})).toMatch(/\/\.local\/state\/tpm\/-w$/);
  });
});

describe('State', () => {
  test('書いた JSON を読める。無ければ undefined', () => {
    expect(state.read('roles/t-x.json')).toBeUndefined();
    state.write('roles/t-x.json', { key: 't-x' });
    expect(state.read('roles/t-x.json')).toEqual({ key: 't-x' });
  });

  test('書きかけのファイルを残さない', () => {
    state.write('tpm.json', { address: 'a' });
    expect(readdirSync(state.dir)).toEqual(['tpm.json']);
  });

  test('folder の中の .json を名前順に並べ、消した物は出ない', () => {
    expect(state.list('roles')).toEqual([]);
    state.write('roles/t-b.json', {});
    state.write('roles/t-a.json', {});
    state.remove('roles/t-b.json');
    state.remove('roles/nope.json');
    expect(state.list('roles')).toEqual(['t-a']);
  });

  test('1 行 1 件の記録を足した順に読める', () => {
    expect(state.lines('log.jsonl')).toEqual([]);
    state.append('log.jsonl', { n: 1 });
    state.append('log.jsonl', { n: 2 });
    expect(state.lines('log.jsonl')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
