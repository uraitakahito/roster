import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { readSkillSets, TpmError } from '../src/skill-sets.js';

// skill セット core・dependabot・a-1 を持つ偽の repo と、config.json を置く folder を作る。
let root: string;
let n = 0;
const config = (text: string): string => {
  const file = join(root, `config-${n++}.json`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-skill-sets-')));
  for (const s of ['core', 'dependabot', 'a-1']) mkdirSync(join(root, s, '.claude', 'skills'), { recursive: true });
});

describe('readSkillSets', () => {
  test('ファイルが無ければ空', () => {
    expect(readSkillSets(join(root, 'nope.json'), root)).toEqual([]);
  });

  test('skill-sets の欄が無ければ空', () => {
    expect(readSkillSets(config('{ "software-engineer": {} }'), root)).toEqual([]);
  });

  test('JSON が object でなくても空', () => {
    expect(readSkillSets(config('[]'), root)).toEqual([]);
  });

  test('書いた順に返し、core と重なりを除く', () => {
    expect(readSkillSets(config('{ "skill-sets": ["a-1", "core", "dependabot", "a-1"] }'), root)).toEqual(['a-1', 'dependabot']);
  });

  test.each([
    ['壊れた JSON', '{ skill-sets: ', /JSON として読めません/],
    ['配列でない skill-sets', '{ "skill-sets": "dependabot" }', /skill-sets は skill セットの名前/],
    ['文字列でない要素', '{ "skill-sets": [1] }', /skill-sets は skill セットの名前/],
    ['大文字の名前', '{ "skill-sets": ["Dependabot"] }', /skill-sets は skill セットの名前/],
    ['道を含む名前', '{ "skill-sets": ["../x"] }', /skill-sets は skill セットの名前/],
    ['無い skill セット', '{ "skill-sets": ["nope"] }', /skill セットがありません: nope/],
  ])('%sなら TpmError', (_, text, message) => {
    const file = config(text);
    expect(() => readSkillSets(file, root)).toThrow(TpmError);
    expect(() => readSkillSets(file, root)).toThrow(message);
  });
});
