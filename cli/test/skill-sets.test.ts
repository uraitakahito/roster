import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { readSkillSets, TpmError } from '../src/skill-sets.ts';

// skill セット core・dependabot・a-1 を持つ偽の repo と、config.jsonc を置く folder を作る。
let root: string;
let n = 0;
const config = (text: string): string => {
  const file = join(root, `config-${n++}.jsonc`);
  writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'roster-skill-sets-')));
  for (const s of ['core', 'dependabot', 'a-1']) mkdirSync(join(root, 'skill-sets', s, '.claude', 'skills'), { recursive: true });
});

describe('readSkillSets', () => {
  test('ファイルが無ければ空', () => {
    expect(readSkillSets(join(root, 'nope.jsonc'), root)).toEqual([]);
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
    ['壊れた JSON', '{ skill-sets: ', /JSONC として読めません/],
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

// merge は roster pr merge だけで打つ（t-pq5v）。skill の文に gh pr merge を打つ手が戻らないように見る（「打たない」と書いた行だけを許す）。
describe('skill の文の merge', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const skills = (dir: string): string[] => readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => join(e.parentPath, e.name));

  test('gh pr merge は「打たない」の行にしか無い', () => {
    const found = skills(join(repo, 'skill-sets')).flatMap(file => readFileSync(file, 'utf8').split('\n')
      .filter(line => line.includes('gh pr merge') && !line.includes('打たない'))
      .map(line => `${file}: ${line}`));
    expect(found).toEqual([]);
  });
});
