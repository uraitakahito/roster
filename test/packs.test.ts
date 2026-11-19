import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { readPacks, TpmError } from '../src/packs.js';

// 束 core・dependabot・a-1 を持つ偽の repo と、config.json を置く folder を作る。
let root: string;
let n = 0;
const config = (text: string): string => {
  const file = join(root, `config-${n++}.json`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-packs-')));
  for (const p of ['core', 'dependabot', 'a-1']) mkdirSync(join(root, p, '.claude', 'skills'), { recursive: true });
});

describe('readPacks', () => {
  test('ファイルが無ければ空', () => {
    expect(readPacks(join(root, 'nope.json'), root)).toEqual([]);
  });

  test('packs の欄が無ければ空', () => {
    expect(readPacks(config('{ "software-engineer": {} }'), root)).toEqual([]);
  });

  test('JSON が object でなくても空', () => {
    expect(readPacks(config('[]'), root)).toEqual([]);
  });

  test('書いた順に返し、core と重なりを除く', () => {
    expect(readPacks(config('{ "packs": ["a-1", "core", "dependabot", "a-1"] }'), root)).toEqual(['a-1', 'dependabot']);
  });

  test.each([
    ['壊れた JSON', '{ packs: ', /JSON として読めません/],
    ['配列でない packs', '{ "packs": "dependabot" }', /packs は束の名前/],
    ['文字列でない要素', '{ "packs": [1] }', /packs は束の名前/],
    ['大文字の名前', '{ "packs": ["Dependabot"] }', /packs は束の名前/],
    ['道を含む名前', '{ "packs": ["../x"] }', /packs は束の名前/],
    ['無い束', '{ "packs": ["nope"] }', /pack がありません: nope/],
  ])('%sなら TpmError', (_, text, message) => {
    const file = config(text);
    expect(() => readPacks(file, root)).toThrow(TpmError);
    expect(() => readPacks(file, root)).toThrow(message);
  });
});
